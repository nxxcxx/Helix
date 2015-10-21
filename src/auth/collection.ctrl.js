module.exports = [ '$scope', 'auth', 'movieCollection', function ( $scope, auth, movieCollection )  {

	window.movieCollection = movieCollection;
	console.log( movieCollection.getCollection() );

} ];
