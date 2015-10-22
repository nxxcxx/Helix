module.exports = [ '$rootScope', function ( $rootScope ) {

	var EVT = {

		EOP: {
			listen: function ( cb ) { $rootScope.$on( 'EOP', cb ); },
			emit: function () { $rootScope.$broadcast( 'EOP' ); }
		},
		collectionModalOpen: {
			listen: function ( cb ) { $rootScope.$on( 'collectionModalOpen', cb ); },
			emit: function () { $rootScope.$broadcast( 'collectionModalOpen' ); }
		},
		collectionModalClose: {
			listen: function ( cb ) { $rootScope.$on( 'collectionModalClose', cb ); },
			emit: function () { $rootScope.$broadcast( 'collectionModalClose' ); }
		}

	};

	return EVT;

} ];
