module.exports = [ 'log', '$scope', 'auth', 'movieCollection', function ( log, $scope, auth, movieCollection )  {

	window.movieCollection = movieCollection;
	log.debug( 'info', 'collectionCtrl', movieCollection.getCollection() );
	var vm = this;
	vm.movieCollection = movieCollection;

} ];
