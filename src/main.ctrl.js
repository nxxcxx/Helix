module.exports = [ '$scope', 'TMDb', 'EVT', 'helix', 'ENGINE',
function ( $scope, TMDb, EVT, helix, ENGINE ) {

	var vm = this;
	vm.search = {
		query: '',
	};
	vm.movieItems = null;

	$scope.$watch( TMDb.getRes, function ( movItems ) {

		vm.movieItems = movItems;
		helix.makeHelixPosters( movItems.slice( TMDb.prevResultLen ), TMDb.prevResultLen );

	}, true );

	var prevQuery = '';
	vm.search = function () {
		if ( vm.search.query === '' ) return;
		if ( prevQuery !== vm.search.query ) {
			prevQuery = vm.search.query;
			TMDb.clearSearch();
			helix.clearAll();
			ENGINE.resetCamera();
		}
		TMDb.request( vm.search );
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
