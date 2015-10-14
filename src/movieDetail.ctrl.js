module.exports = [ 'log', '$scope', '$stateParams', 'TMDb', '$cacheFactory', 'movieItem',
function( log, $scope, $stateParams, TMDb, $cacheFactory, movieItem ) {

	var vm = this;
	// vm.movieItem = TMDb.searchById( $stateParams.movieId );
	vm.movieItem = movieItem;
	log.debug( 'info', 'movieDetail ctrl', vm.movieItem );

} ];
