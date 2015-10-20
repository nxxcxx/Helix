module.exports = [ '$scope', '$http', 'ENDPOINT_URI', 'authToken', '$state',
function ( $scope, $http, ENDPOINT_URI, authToken, $state )  {

	var vm = this;
	vm.user = {
		email: '',
		password: ''
	};

	vm.signin = function() {

		if ( vm.user.email === '' || vm.user.password === '' ) {
			console.log( 'email & password required.' );
			return;
		}

		$http.post( ENDPOINT_URI + 'signin', vm.user )
			.then( function( res ) {
				console.log( res );
				authToken.setToken( res.data.token );
				$state.go( 'private' );
			}, function( err, status ) {
				console.warn( err );
			} );

	};

} ];
