module.exports = [ 'log', '$scope', 'TMDb', 'EVT', 'helix', 'ENGINE',
function ( log, $scope, TMDb, EVT, helix, ENGINE ) {

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
		TMDb.searchByTitle( vm.search );
	};

	// DEBUG
	window.SCOPE = $scope;
	vm.TMDb = TMDb;
	vm.helix = helix;
	vm.ENGINE = ENGINE;

	EVT.EOP.listen( function () {
		log.debug( 'info', 'recieved EOP event!' );
	} );

} ];
