module.exports = [ 'log', '$scope', 'TMDb', 'EVT', 'helix', 'ENGINE', 'auth', '$state', '$rootScope',
function ( log, $scope, TMDb, EVT, helix, ENGINE, auth, $state, $rootScope ) {

	var vm = this;
	vm.auth = auth;
	vm.search = {
		query: '',
	};
	vm.movieItems = null;

	$scope.$watch( TMDb.getRes, function ( movItems, oldMovItems ) {

		vm.movieItems = movItems;
		helix.makeHelixPosters( movItems.slice( oldMovItems.length ), oldMovItems.length );

	}, true );

	var prevQuery = '';
	var helixNeedsReset = false;
	EVT.helixNeedsReset.listen( function () {
		helixNeedsReset = true;
	} );

	vm.search = function () {
		if ( vm.search.query === '' ) return;
		if ( prevQuery !== vm.search.query || helixNeedsReset ) {
			prevQuery = vm.search.query;
			TMDb.clearSearch();
			helix.clearAll();
			ENGINE.resetCamera();
			helixNeedsReset = false;
		}
		if ( $state.current.name !== 'helix' ) {
			$state.go( 'helix' );
		}
		TMDb.searchByTitle( vm.search );
	};

	// DEBUG
	window.SCOPE = $scope;
	vm.TMDb = TMDb;
	vm.helix = helix;
	vm.ENGINE = ENGINE;
	vm.STATE = $state;

	EVT.EOP.listen( function () {
		log.debug( 'info', 'recieved EOP event!' );
	} );

} ];
