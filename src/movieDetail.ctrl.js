module.exports = [ 'log', '$scope', 'TMDb', '$cacheFactory', 'movieItem', 'collectionModalService',
function( log, $scope, TMDb, $cacheFactory, movieItem, collectionModalService ) {

	var vm = this;
	vm.movieItem = movieItem; // movieItem injected via state resolve
	log.debug( 'ctrl', 'movieDetail ctrl resolved:', vm.movieItem );

	movieItem.fullTitle = movieItem.title;
	if ( movieItem.title !== movieItem.original_title ) {
		movieItem.fullTitle = movieItem.title + ' (' + movieItem.original_title + ')';
	}

	if ( movieItem.backdrop_path ) {
		var imgUrl = 'http://image.tmdb.org/t/p/original' + movieItem.backdrop_path;
		$( '.backdrop' ).css( {
			'background-image': 'url(' + imgUrl + ')'
		} );
	}

	vm.openCollectionModal = function () {
		collectionModalService.setActiveItem( movieItem );
		collectionModalService.open();
	};

} ];
