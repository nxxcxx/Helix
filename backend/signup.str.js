'use strict';

var User = require( './models/user.js' );
var LocalStrategy = require( 'passport-local' ).Strategy;

var registerStrategy = new LocalStrategy( {
	usernameField: 'email',
	passwordField: 'password'
},
function ( email, password, done ) {

	User.findOne( { email: email }, function( err, user ) {

		if ( err ) return done( err );
		if ( user ) return done( null, false, { message: 'user already exist.' } );

		var newUser = new User( {
			email: email,
			password: password
		} );

		newUser.save( function ( err ) {

			if ( err ) return done( err );
			return done( null, newUser );

		} );

	} );

} );

module.exports = registerStrategy;
