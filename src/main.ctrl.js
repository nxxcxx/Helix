module.exports = [ '$scope', 'TMDb', 'EVT', 'helixWall',
function ( $scope, TMDb, EVT, helixWall )  {

	var vm = this;
	vm.search = {
		query: '',
	};
	vm.movieItems = null;

	$scope.$watch( TMDb.getRes, function ( res ) {
		vm.movieItems = res;
	}, true );

	var prevQuery = '';
	vm.search = function () {
		if ( vm.search.query === '' ) return;
		if ( prevQuery !== vm.search.query ) {
			TMDb.clearSearch();
			prevQuery = vm.search.query;
		}
		TMDb.req( vm.search );
	};

	vm.makeHelixWall = function () {
		helixWall.makeHelixPosters( vm.movieItems );
	};

	// DEBUG
	window.SCOPE = $scope;
	vm.TMDb = TMDb;
	vm.helix = helixWall;

	EVT.EOP.listen( function () {
		console.log( 'recieved EOP event!' );
	} );

} ];
