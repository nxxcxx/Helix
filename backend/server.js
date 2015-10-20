'use strict';

var express = require( 'express' );
var mongoose = require( 'mongoose' );
var bodyParser = require( 'body-parser' );
var cors = require( 'cors' );
var moment = require( 'moment' );
var chalk = require( 'chalk' );
var jwt = require( 'jsonwebtoken' );
var fs = require( 'fs' );
var PRIVATE_KEY = fs.readFileSync( __dirname + '/private.key' );

mongoose.connect( 'mongodb://localhost/TMDb' );
var db = mongoose.connection;
db.on( 'error', console.error.bind( console, chalk.red( 'DB connection error' ) ) );
db.once( 'open', console.log.bind( console, chalk.cyan( 'DB connection successful' ) ) );

var passport = require( 'passport' );
passport.use( 'register-strategy', require( './register.str.js' ) );
passport.use( 'login-strategy', require( './login.str.js' ) );

var app = express();
app.use( passport.initialize() );
app.use( bodyParser.json() );
app.use( cors() );

app.use( function ( req, res, next ) {
	console.log( req.method, req.url, '\t' + moment().format() );
	next();
} );

app.use( require( './TMDb.js' ) );

app.post( '/signup', function ( req, res ) {
	authenticate( 'register-strategy', req, res );
} );

app.post( '/signin', function ( req, res ) {
	authenticate( 'login-strategy', req, res );
} );

app.get( '/auth', function ( req, res ) {

	if ( !req.headers.authorization )
		return res.status( 401 ).send( 'not logged in.' );

	var authHeader = req.headers.authorization.split( ' ' );
	var scheme = authHeader[ 0 ];
	var token = authHeader[ 1 ];

	if ( !token || scheme !== 'Bearer' )
		return res.status( 401 ).send( 'invalid token.' );

	jwt.verify( token, PRIVATE_KEY, function ( err, payload ) {

		if ( err ) return res.status( 401 ).send( err );
		res.status( 200 ).send( payload );

	} );

} );

var server = app.listen( 8001, function () {
	console.log( chalk.cyan( 'Listening on port:', server.address().port, moment().format() ) );
} );

function authenticate( strategy, req, res ) {

	passport.authenticate( strategy, {
		session: false
	}, function ( err, user, info ) {

		if ( err )
			return res.status( 500 ).send( 'WTF' );
		if ( !user )
			return res.status( 409 ).send( info.message );

		var token = generateToken( user );
		return res.status( 200 ).send( token );

	} )( req, res );

}

function generateToken( user ) {

	var payload = {
		sub: user.id
	};

	var token = jwt.sign( payload, PRIVATE_KEY, {
		expiresIn: 3600
	} );
	
	return {
		user: user.toJSON(),
		token: token
	};

}
