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

var app = express();
app.use( bodyParser.json() );
app.use( cors() );

app.use( function ( req, res, next ) {
	console.log( req.method, req.url, '\t' + moment().format() );
	next();
} );

app.use( require( './TMDb.js' ) );

var server = app.listen( 8001, function () {
	console.log( chalk.cyan( 'Listening on port:', server.address().port, moment().format() ) );
} );
