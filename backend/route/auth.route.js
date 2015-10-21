'use strict';

var jwt = require( 'jsonwebtoken' );
var passport = require( 'passport' );
var router = require( 'express' ).Router();
var PRIVATE_KEY = require( 'fs' ).readFileSync( __dirname + '/../private.key' );

router
	.post( '/signup', function ( req, res ) {
		authenticate( 'signup-strategy', req, res );
	} )
	.post( '/signin', function ( req, res ) {
		authenticate( 'signin-strategy', req, res );
	} )
	.get( '/auth', function ( req, res ) {

		if ( !req.headers.authorization )
			return res.status( 401 ).send( 'not signed in.' );

		var authHeader = req.headers.authorization.split( ' ' );
		var scheme = authHeader[ 0 ];
		var token = authHeader[ 1 ];

		if ( !token || scheme !== 'Bearer' )
			return res.status( 401 ).send( 'invalid token.' );

		jwt.verify( token, PRIVATE_KEY, function ( err, payload ) {

			if ( err ) return res.status( 401 ).send( err );
			// console.log( payload );
			res.status( 200 ).send( payload );

		} );

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
		userId: user.id
	};

	var token = jwt.sign( payload, PRIVATE_KEY, {
		expiresIn: 3600
	} );

	return {
		user: user.toJSON(),
		token: token
	};

}

module.exports = router;
