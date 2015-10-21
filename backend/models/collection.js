var mongoose = require( 'mongoose' );
var Schema = mongoose.Schema;

var collectionSchema = new Schema( {
	userId: String,
	collections: [ { collectionName: String, movies: Array } ]
} );

collectionSchema.methods.toJSON = function () {
	return this.collections;
};

module.exports = mongoose.model( 'collection', collectionSchema, 'collections' );
