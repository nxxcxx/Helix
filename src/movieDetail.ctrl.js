module.exports = [ 'log', '$scope', 'TMDb', '$cacheFactory', 'movieItem',
function( log, $scope, TMDb, $cacheFactory, movieItem ) {

	var vm = this;
	vm.movieItem = movieItem; // movieItem injected via state resolve
	log.debug( 'info', 'movieDetail ctrl', vm.movieItem );

} ];
