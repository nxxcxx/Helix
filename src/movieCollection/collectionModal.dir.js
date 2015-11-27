module.exports = [ 'log', 'movieCollection', 'collectionModalService', 'EVT',
function ( log, movieCollection, collectionModalService, EVT ) {

	function ctrl( $scope, $element, $attrs ) {

		var vm = this;
		vm.movieCollection = movieCollection;
		vm.collectionModalService = collectionModalService;

		vm.addingNewCollection = false;

		vm.openEditor = function () {
			vm.addingNewCollection = true;
		};

		vm.closeEditor = function () {
			vm.addingNewCollection = false;
		};

		vm.createNewCollection = function () {
			if ( $scope.newCollectionName ) {
				movieCollection.create( $scope.newCollectionName );
				$scope.newCollectionName = '';
				vm.closeEditor();
			}
		};

		vm.addToCollection = function ( movieId, collectionName ) {
			log.debug( 'collection', 'addToCollection:', movieId, collectionName );
			var success = movieCollection.push( movieId, collectionName );
			log.debug( 'collection', 'movieCollection.push', success );
		};

		vm.closeModal = function () {
			vm.addingNewCollection = false;
			$scope.newCollectionName = '';
			collectionModalService.close();
		};

		// default css at directive initialization
		$element.css( { visibility: 'hidden' } );

		EVT.collectionModalOpen.listen( function () {
			log.debug( 'collection', 'collectionModalOpen' );
		$element.css( { visibility: 'visible' } );
		} );

		EVT.collectionModalClose.listen( function () {
			log.debug( 'collection', 'collectionModalClose' );
		$element.css( { visibility: 'hidden' } );
		} );

	}

	return {

		restrict: 'E',
		scope: {},
		controller: ctrl,
		controllerAs: 'modal',
		replace: true,
		templateUrl: './template/collectionModal.html'

	};

} ];
