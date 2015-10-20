module.exports = [ '$scope', '$http', 'ENDPOINT_URI', 'authToken', '$state',
function ( $scope, $http, ENDPOINT_URI, authToken, $state ) {

		var vm = this;
		vm.user = {};

		vm.signup = function () {

			if ( vm.user.email === undefined || vm.user.password === undefined ) {
				console.log( 'email & password required.' );
				return;
			}

			console.log( 'Registering...' );
			$http.post( ENDPOINT_URI + 'signup', vm.user )
				.then( function ( res ) {

					console.log( 'Registered.' );
					console.log( res );
					// login
					authToken.setToken( res.data.token );
					$state.go( 'private' );

				}, function ( err ) {

					console.warn( err );
					vm.form.$submitted = false;

				} );

		};

} ];
