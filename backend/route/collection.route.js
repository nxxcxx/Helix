'use strict';

var chalk = require( 'chalk' );
var router = require( 'express' ).Router();
var Collection = require( '../models/collection.js' );
var jwt = require( 'jsonwebtoken' );
var PRIVATE_KEY = require( 'fs' ).readFileSync( __dirname + '/../private.key' );

router.route( '/collection' )
	.get( function ( req, res ) {

		// to do refactor dupes code here
		if ( !req.headers.authorization )
			return res.status( 401 ).send( 'not signed in.' );

		var authHeader = req.headers.authorization.split( ' ' );
		var scheme = authHeader[ 0 ];
		var token = authHeader[ 1 ];

		if ( !token || scheme !== 'Bearer' )
			return res.status( 401 ).send( 'invalid token.' );

		jwt.verify( token, PRIVATE_KEY, function ( err, payload ) {

			if ( err ) return res.status( 401 ).send( err );

			Collection.findOne( { userId: payload.userId }, function ( err, collection ) {

				if ( err ) return res.status( 500 ).send( 'WTF' );
				if ( collection ) return res.status( 200 ).send( collection.toJSON() );
				res.status( 200 ).send();

			} );

		} );

	} )
	.put( function ( req, res ) {

		if ( !req.body ) {
			console.log( 'PUT', 'req.body empty' );
			return res.status( 200 ).send( 'empty body' );
		}

		if ( !req.headers.authorization )
			return res.status( 401 ).send( 'not signed in.' );

		var authHeader = req.headers.authorization.split( ' ' );
		var scheme = authHeader[ 0 ];
		var token = authHeader[ 1 ];

		if ( !token || scheme !== 'Bearer' )
			return res.status( 401 ).send( 'invalid token.' );

		jwt.verify( token, PRIVATE_KEY, function ( err, payload ) {

			if ( err ) return res.status( 401 ).send( err );

			var collection = {
				userId: payload.userId,
				collections: req.body
			};

			Collection.update( { userId: payload.userId }, collection, { upsert: true }, function ( err ) {
				if ( err ) return res.status( 500 ).send( 'WTF' );
				return res.status( 200 ).send( collection );
			} );

		} );

	} );

module.exports = router;
