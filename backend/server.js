'use strict';

var express = require( 'express' );
var mongoose = require( 'mongoose' );
var chalk = require( 'chalk' );

mongoose.connect( 'mongodb://localhost/TMDb' );
var db = mongoose.connection;
db.on( 'error', console.error.bind( console, chalk.red( 'DB connection error' ) ) );
db.once( 'open', console.log.bind( console, chalk.cyan( 'DB connection successful' ) ) );

var app = express();

app.use( function ( req, res, next ) {
	console.log( req.method, req.url );
	next();
} );


var Movie = require( './models/movie.js' );

app.get( '/test', function ( req, res ) {

	var newMovie = new Movie( {
		title: 'A' + Math.random(),
		id: Math.random()
	} );

	newMovie.save( function ( err ) {
		if ( err ) return res.status( 500 ).send( 'WTF' );
		res.status( 200 ).send( 'saved to DB' );
	} );

} );

var server = app.listen( 8001, function () {
	console.log( chalk.cyan( 'Listening on port:', server.address().port ) );
} );
