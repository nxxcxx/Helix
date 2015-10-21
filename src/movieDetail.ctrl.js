module.exports = [ 'log', '$scope', 'TMDb', '$cacheFactory', 'movieItem',
function( log, $scope, TMDb, $cacheFactory, movieItem ) {

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

	vm.addToCollection = function () {
		console.log( movieItem.id );
		// prompt up collection modal -> fetch usr's collection -> allow user to select which collection to add to -> save to DB
	};

} ];
