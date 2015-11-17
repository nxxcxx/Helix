module.exports = [ 'log', '$scope', 'auth', 'movieCollection', 'TMDb', 'helix', 'ENGINE', '$state', 'EVT',
function ( log, $scope, auth, movieCollection, TMDb, helix, ENGINE, $state, EVT )  {

	log.debug( 'collection', 'collectionCtrl', movieCollection.getCollection() );
	var vm = this;
	vm.movieCollection = movieCollection;

	vm.viewCollection = function ( collection ) {

		log.debug( 'info', 'viewCollection =>', collection );

		var loadedItems = 0;
		var totalItems = collection.movies.length;
		var allMovies = [];

		collection.movies.forEach( function ( movieId ) {

			TMDb.searchById( movieId )
				.then( function ( res ) {
					allMovies.push( res );
				}, function ( err ) {
					log.debug( 'err', 'viewCollection =>', err );
				} )
				.finally( function () {
					if ( ++loadedItems === totalItems ) {

						helix.clearAll();
						ENGINE.resetCamera();
						helix.makeHelixPosters( allMovies, 0 );
						$state.go( 'helix' );
						TMDb.clearSearch();
						EVT.helixNeedsReset.emit();

					}
				} );

		} );


	};


} ];
