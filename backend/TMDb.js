'use strict';

var chalk = require( 'chalk' );
var express = require( 'express' );
var router = express.Router();
var Movie = require( './models/movie.js' );

router.route( '/movie/:id' )
	.get( function ( req, res ) {

		var movId = req.params.id;
		Movie.findOne( { id: movId }, function ( err, movie ) {
			if ( err ) return res.status( 500 ).send( 'WTF' );
			res.status( 200 ).send( movie );
		} );

	} )
	.put( function ( req, res ) {

		if ( !req.body ) {
			console.log( 'PUT', 'req.body empty' );
			res.status( 200 ).send( 'empty body' );
			return;
		}
		// upsert option create doc if not exists
		Movie.update( { id: req.body.id }, req.body, { upsert: true }, function ( err ) {
			if ( err ) return res.status( 500 ).send( 'WTF' );
			res.status( 200 ).send( req.body );
			console.log( chalk.green( 'PUT AC', req.params.id ) );
		} );

	} );

module.exports = router;
