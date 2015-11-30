module.exports = [ '$state', '$stateParams', 'movieCollection', function ( $state, $stateParams, movieCollection ) {

	var vm = this;
	vm.collectionName = $stateParams.collectionName;

	vm.settings = {};

	vm.deleteCollection = function () {
		if ( vm.settings.deleteNameConfirm === vm.collectionName ) {
			movieCollection.removeCollection( vm.settings.deleteNameConfirm );
			$state.go( 'collection' );
		}
	};

	vm.renameCollection = function () {
		movieCollection.renameCollection( vm.collectionName, vm.settings.newName );
		$state.go( 'collection' );
	}

} ];
