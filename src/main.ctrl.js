module.exports = [ '$scope', 'TMDb', 'EVT',
function ( $scope, TMDb, EVT )  {

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

	// DEBUG
	window.SCOPE = $scope;
	vm.TMDb = TMDb;

	EVT.EOP.listen( function () {
		console.log( 'recieved EOP event!' );
	} );

} ];
