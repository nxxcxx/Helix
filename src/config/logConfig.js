module.exports = [ 'logProvider', '$httpProvider', function ( logProvider, $httpProvider ) {

	logProvider.enableDebug();
	// logProvider.enableDebugNamespace( 'info', 'err', 'auth', 'api', 'collection' );
	logProvider.enableDebugNamespace( 'info', 'err' );

	$httpProvider.useLegacyPromiseExtensions( false );

} ];
