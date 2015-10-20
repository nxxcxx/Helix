module.exports = [ '$state', 'auth', function ( $state, auth )  {

	auth.deauthorize();
	$state.go( 'signin' );

} ];
