'use strict';

var User = require( './models/user.js' );
var LocalStrategy = require( 'passport-local' ).Strategy;

var signinStrategy = new LocalStrategy( {
	usernameField: 'email',
	passwordField: 'password'
},
function ( email, password, done ) {

	User.findOne( { email: email }, function( err, user ) {

		if ( err ) return done( err );
		if ( !user ) return done( null, false, { message: 'invalid user.' } );

		user.comparePassword( password, function ( err, isMatch ) {

			if ( err ) return done( err );
			if ( isMatch ) return done( null, user );

			return done( null, false, { message: 'invalid password.' } );

		} );

	} );

} );

module.exports = signinStrategy;
