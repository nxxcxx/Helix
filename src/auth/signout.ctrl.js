module.exports = [ '$state', 'auth', 'movieCollection', function ( $state, auth, movieCollection )  {

	auth.deauthorize();
	movieCollection._clear();
	$state.go( 'signin' );

} ];
