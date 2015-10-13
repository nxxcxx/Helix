module.exports = [ '$scope', 'TMDb', 'EVT', 'helix', 'ENGINE',
function ( $scope, TMDb, EVT, helix, ENGINE )  {

	var vm = this;
	vm.search = {
		query: '',
	};
	vm.movieItems = null;

	$scope.$watch( TMDb.getRes, function ( movItems, prevMovItems ) {

		vm.movieItems = movItems;
		helix.makeHelixPosters( movItems.slice( prevMovItems.length ), prevMovItems.length );

	}, true );

	var prevQuery = '';
	vm.search = function () {
		if ( vm.search.query === '' ) return;
		if ( prevQuery !== vm.search.query ) {
			TMDb.clearSearch();
			prevQuery = vm.search.query;

			helix.clearAll();
			ENGINE.resetCamera();

		}
		TMDb.req( vm.search );
	};

	vm.makeHelixWall = function () {
		helix.makeHelixPosters( vm.movieItems );
	};

	// DEBUG
	window.SCOPE = $scope;
	vm.TMDb = TMDb;
	vm.helix = helix;
	vm.ENGINE = ENGINE;

	EVT.EOP.listen( function () {
		console.log( 'recieved EOP event!' );
	} );

} ];
