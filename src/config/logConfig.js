module.exports = [ 'logProvider', '$httpProvider', function ( logProvider, $httpProvider ) {

	logProvider.enableDebug();
	logProvider.enableDebugNamespace( 'info', 'err', 'auth' );

	$httpProvider.useLegacyPromiseExtensions( false );

} ];
