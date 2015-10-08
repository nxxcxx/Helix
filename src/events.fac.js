module.exports = [ '$rootScope', function ( $rootScope ) {

	var EVT = {

		EOP: {
			listen: function ( cb ) { $rootScope.$on( 'EOP', cb ); },
			emit: function () { $rootScope.$broadcast( 'EOP' ); }
		},

	};

	return EVT;

} ];
