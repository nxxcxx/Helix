var mongoose = require( 'mongoose' );
var Schema = mongoose.Schema;

var movieSchema = new Schema( {
	adult: Boolean,
	backdrop_path: String,
	genre_ids: Array,
	id: Number,
	original_language: String,
	original_title: String,
	overview: String,
	release_date: String,
	poster_path: String,
	popularity: Number,
	title: String,
	video: Boolean,
	vote_average: Number,
	vote_count: Number
} );

module.exports = mongoose.model( 'movie', movieSchema, 'movies' );
