'use strict';

var express = require( 'express' );
var mongoose = require( 'mongoose' );
var bodyParser = require( 'body-parser' );
var cors = require( 'cors' );
var moment = require( 'moment' );
var chalk = require( 'chalk' );

mongoose.connect( 'mongodb://localhost/TMDb' );
var db = mongoose.connection;
db.on( 'error', console.error.bind( console, chalk.red( 'DB connection error' ) ) );
db.once( 'open', console.log.bind( console, chalk.cyan( 'DB connection successful' ) ) );

var passport = require( 'passport' );
passport.use( 'signup-strategy', require( './signup.str.js' ) );
passport.use( 'signin-strategy', require( './signin.str.js' ) );

var app = express();
app.use( passport.initialize() );
app.use( bodyParser.json() );
app.use( cors() );

app.use( function ( req, res, next ) {
	console.log( req.method, req.url, '\t' + getDate() );
	next();
} );

app.use( require( './route/TMDb.route.js' ) );
app.use( require( './route/auth.route.js' ) );


var server = app.listen( 8001, function () {
	console.log( chalk.cyan( 'Listening on port:', server.address().port, getDate() ) );
} );

function getDate() {
	return moment().format( 'DD/MM/YY hh:mm:ss a');
}
