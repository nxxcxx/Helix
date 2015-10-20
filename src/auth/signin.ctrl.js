module.exports = [ 'log', '$scope', '$http', 'ENDPOINT_URI', 'authToken', '$state',
function ( log, $scope, $http, ENDPOINT_URI, authToken, $state )  {

	var vm = this;
	vm.user = {
		email: '',
		password: ''
	};

	vm.signin = function() {

		if ( vm.user.email === '' || vm.user.password === '' ) {
			log.debug( 'warn', 'email & password required.' );
			return;
		}

		$http.post( ENDPOINT_URI + 'signin', vm.user )
			.then( function( res ) {
				log.debug( 'info', res, res.data );
				authToken.setToken( res.data.token );
				$state.go( 'collection' );
			}, function( err, status ) {
				log.debug( 'warn', err );
			} );

	};

} ];
