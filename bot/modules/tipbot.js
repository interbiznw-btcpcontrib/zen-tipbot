'use strict';

const config = require( 'config' );

const bitcoin = require( 'bitcoin' );
const zen = new bitcoin.Client( config.get( 'zen' ));

const mongoose = require( 'mongoose' );
mongoose.Promise = global.Promise;
const mongodb = config.get( 'mongodb' );
mongoose.connect( mongodb.url, mongodb.options );
const db = mongoose.connection;
db.on( 'error', console.error.bind( console, "connection error: " ));
db.once( 'open', function() {
  console.log( "Mongodb: connected to '" + this.host + "/" + this.name + "'!" );
});
const userSchema = mongoose.Schema({
    "discordID": String,
    "address": String,
    "spent": Number,
    "received": Number
});
const User = mongoose.model( 'User', userSchema );


exports.commands = [
  "tip"
];
exports.tip = {
  usage: "<subcommand>",

  description: "Here is the commands you can use:\n"
  + "**!help** : display this message.\n"
  + "**!deposit** : get an address to top up your balance (maximum 1 ZEN).\n"
  + "**!balance** : get your balance.\n"
  + "**!withdraw <amount> <address>** : withdraw <amount> ZENs from your"
    + " balance to your <address>.\n"
  + "**!tip <@user> <amount> [message]** : tip <@user> <amount> ZENs (maximum"
    + " 1 ZEN) and leave an optional [message].\n"
  + "**!each <amount> <n> [message]** : drop a packet in a channel, the"
    + " <amount> is divided *equally* between the <n> first people to open"
    + " the packet. Leave an optionnal [message] with the packet.\n"
  + "**!luck <amount> <n> [message]** : drop a packet in a channel, the"
    + " <amount> is divided *randomly* between the <n> first people to open"
    + " the packet. Leave an optionnal [message] with the packet.\n"
  + "**!open** : open the latest packet dropped into the channel.\n",

  process: async function( bot, msg, suffix ){
    getUser( msg.author.id, function( err, doc ){
      if( err ) return console.error( err );

      const tipper = doc;
      const words = msg.content.trim().split(' ').filter(
        function( n ){ return n !== ""; }
      );
      const subcommand = words.length >= 2 ? words[ 1 ] : 'help';

      switch( subcommand ){
        case 'help':
          doHelp( msg );
          break;

        case 'balance':
          doBalance( msg, tipper );
          break;

        case 'deposit':
          doDeposit( msg, tipper );
          break;

        case 'withdraw':
          doWithdraw( msg, tipper, words );
          break;

        default:
          doTip( msg, tipper, words );
      }

    });
  }
};


function doHelp( message ){
  if( message.channel.type != 'dm' )
    return message.reply( 'Please DM me for this command.' );

  message.author.send(
    "**BETATEST: PLEASE USE TESTNET ZEN ONLY !**\n"
    + "Here is the commands you can use:\n"
    + "**!tip help** : display this message.\n"
    + "**!tip deposit** : get an address to top up your balance.\n"
    + "**!tip balance** : get your balance.\n"
    + "**!tip withdraw <amount> <address>** : withdraw <amount> ZENs from your"
      + " balance to your <address>.\n"
    + "**!tip <@user> <amount>** : tip <@user> <amount> ZENs"
  );
}


function getUser( id, cb ){
  //  default user
  const user = new User({
    discordID: id,
    address: "",
    spent: 0,
    received: 0
  });

  //  look for user in DB
  User.findOne({ 'discordID': id }, function( err, doc ){
    if( err ) return cb( err, null );

    if( doc ) {
      //  Existing User
      cb( null, doc );

    } else {
      //  New User
      zen.getNewAddress( function( err, address ){
        if( err ) return cb( err, null );
        user.address = address;
        user.save( function( err ){
          if( err ) cb( err, null );
          cb( null, user );
        });
      });
    }
  });
}


/*
**  calculate and return user's balance
**  /!\ DO NOT CONFUSE WITH doBalance /!\
*/
function getBalance( tipper, cb ){
  //  tipper has no address, never made a deposit
  if( !tipper.address ) return cb( null, tipper.received - tipper.spent );

  //  balance = total deposit amount + total received - total spent
  zen.cmd( 'getreceivedbyaddress', tipper.address, function( err, amount ){
    if( err ) return cb( err, null );

    const balance = amount + tipper.received - tipper.spent;
    return cb( null, balance );
  });
}


/*
**  reply to !tip balance and display user's balance
**  /!\ DO NOT CONFUSE WITH getBalance /!\
*/
function doBalance( message, tipper ){
  if( message.channel.type != 'dm' )
    return message.reply( 'Please DM me for this command.' );

  getBalance( tipper, function( err, balance ){
    if( err ) return message.reply( 'Error getting balance' );

    message.reply( "**BETATEST: PLEASE USE TESTNET ZEN ONLY !**\n"
    + 'You have **' + balance + '** ZEN' );
  });
}


function doDeposit( message, tipper ){
  if( message.channel.type != 'dm' )
    return message.reply( 'Please DM me for this command.' );

  if( tipper.address ){
    //  tipper already has a deposit address
    message.reply( "**BETATEST: PLEASE USE TESTNET ZEN ONLY !**\n"
    + 'Your deposit address is: ' + tipper.address );
  } else {
    //  tipper has no deposit address yet, generate a new one
    zen.getNewAddress( function( err, address ){
      if( err ) return message.reply( "**BETATEST: PLEASE USE TESTNET ZEN ONLY !**\n" + 'Error getting deposit address' );

      User.update(
        { discordID: tipper.discordID },
        { '$set': { address: address }},
        function( err, raw ){
          if( err ){
            console.error( err );
          } else {
            console.log( raw );
            message.reply( "**BETATEST: PLEASE USE TESTNET ZEN ONLY !**\n"
            + 'Your deposit address is: ' + address );
          }
        }
      );
    });
  }
}


function doWithdraw( message, tipper, words ){
  if( message.channel.type != 'dm' )
    return message.reply( 'Please DM me for this command.' );

  //  wrong command syntax
  if( words.length < 4 || !words ) return doHelp( message );

  getBalance( tipper, function( err, balance ){
    if( err ) return message.reply( 'Error getting balance' );

    const amount = getValidatedAmount( words[ 2 ], balance );
    if( amount === null )
      return message.reply( 'I dont know how to withdraw that many credits' );
    const address = words[ 3 ];

    zen.cmd( 'sendtoaddress', address, amount, '', '', true,
      function( err, txId ){
        if( err ){
          message.reply( err.message );
        } else {
          // update tipper's spent amount
          User.update(
            { discordID: tipper.discordID },
            { '$inc': { spent: amount }},
            function( err, raw ){
              if( err ){
                console.error( err );
              } else {
                console.log( raw );
              }
            }
          );
          message.reply(
            'You withdrew **' + amount +
            ' ZEN** to **' + address +
            '** (' + txLink( txId ) + ')'
          );
        }
      }
    );
  });
}


function doTip( message, tipper, words ){
  //  wrong command syntax
  if( words.length < 3 || !words ) return doHelp( message );

  getBalance( tipper, function( err, balance ){
    if( err ) return message.reply( 'Error getting balance' );

    const amount = getValidatedAmount( words[ 2 ], balance );
    if( amount === null )
      return message.reply( 'I dont know how to tip that many credits' );

    if( message.mentions.members.first().id ){
      //  get receiver's id
      const user = message.mentions.members.first();
      //  prevent user from tipping him/her self
      if( tipper.discordID == user.id)
        return message.reply( 'No, you cannot tip yourself...' );

      getUser( user.id, function( err, receiver ){
        if( err ) return message.reply( err.message );

        sendZen( tipper, receiver, amount );
        message.author.sendMessage(
          '<@' + receiver.discordID + '> received your tip !'
        );
        user.sendMessage(
          '<@' + tipper.discordID + '> sent you a **' + amount + ' ZEN** tip !'
        );
      });

    } else {
      message.reply( 'Sorry, I could not find a user in your tip...' );
    }
  });
}


function sendZen( tipper, receiver, amount ){
  // update tipper's spent amount
  User.update(
    { discordID: tipper.discordID },
    { '$inc': { spent: amount }},
    function( err, raw ){
      if( err ){
        console.error( err );
      } else {
        console.log( raw );
      }
    }
  );

  // and receiver's received amount
  User.update(
    { discordID: receiver.discordID },
    { '$inc': {received: amount }},
    function( err, raw ){
      if( err ){
        console.error( err );
      } else {
        console.log( raw );
      }
    }
  );
};


/*
**  validate syntax and check if user's balance
**  is enough to manipulate the requested amount
**  and also stop manipulation if amount is 0
*/
function getValidatedAmount( amount, balance ){
  amount = amount.trim();
  if ( amount.toLowerCase().endsWith( 'zen' )) {
    amount = amount.substring( 0, amount.length - 3 );
  }

  if( amount.match( /^[0-9]+(\.[0-9]+)?$/ )){
    amount = parseFloat( amount );

    if( amount > 0 && amount <= balance ){
      return amount;
    }
  }

  return null;
}


function txLink( txId ){
  return "<https://explorer.zensystem.io/tx/" + txId + ">";
}