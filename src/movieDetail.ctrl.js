module.exports = [ '$scope', '$stateParams', 'TMDb', '$cacheFactory', function( $scope, $stateParams, TMDb, $cacheFactory ) {

	var vm = this;
	var movieIdCache =  $cacheFactory.get( 'movieIdCache' );
	vm.movieItem = movieIdCache.get( $stateParams.movieId );
	// todo if specify movie id to url directly ( load from API if not in cache )
	console.log( $scope );

} ];
