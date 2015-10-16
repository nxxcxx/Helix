module.exports = [ 'log', '$scope', 'TMDb', '$cacheFactory', 'movieItem',
function( log, $scope, TMDb, $cacheFactory, movieItem ) {

	var vm = this;
	vm.movieItem = movieItem; // movieItem injected via state resolve
	log.debug( 'ctrl', 'movieDetail ctrl resolved:', vm.movieItem );

	movieItem.fullTitle = movieItem.title;
	if ( movieItem.title !== movieItem.original_title ) {
		movieItem.fullTitle = movieItem.title + ' (' + movieItem.original_title + ')';
	}

} ];
