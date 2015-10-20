var bcrypt = require( 'bcrypt-nodejs' );
var mongoose = require( 'mongoose' );
var Schema = mongoose.Schema;

var userSchema = new Schema( {
	email: String,
	password: String
} );

userSchema.pre( 'save', function ( next ) {
	var user = this;
	if ( !user.isModified( 'password' ) ) return next();
	bcrypt.hash( user.password, null, null, function ( err, hash ) {
		if ( err ) return next( err );
		user.password = hash;
		next();
	} );
} );

userSchema.methods.comparePassword = function ( password, callback ) {
	bcrypt.compare( password, this.password, callback );
};

userSchema.methods.toJSON = function () {
	var user = this.toObject();
	delete user.password;
	return user;
};

module.exports = mongoose.model( 'user', userSchema, 'users' );
