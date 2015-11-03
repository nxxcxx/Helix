module.exports = [ 'log', '$scope', 'auth', 'movieCollection', function ( log, $scope, auth, movieCollection )  {

	log.debug( 'collection', 'collectionCtrl', movieCollection.getCollection() );
	var vm = this;
	vm.movieCollection = movieCollection;

	vm.viewCollection = function ( collection ) {
		console.log( collection );
		/* call movieCollection.fetchAll()
			clearHelix()
			call make helix w/ fetched result
			ui state -> helix
		*/
	};


} ];
