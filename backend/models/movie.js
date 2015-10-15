var mongoose = require( 'mongoose' );
var Schema = mongoose.Schema;

var movieSchema = new Schema( {
	title: String,
	id: Number
} );

movieSchema.methods.toJSON = function () {
	return this.toObject();
};

module.exports = mongoose.model( 'movie', movieSchema, 'movies' );
