module.exports = [ 'log', '$scope', '$http', 'ENDPOINT_URI', 'authToken', '$state',
function ( log, $scope, $http, ENDPOINT_URI, authToken, $state ) {

		var vm = this;
		vm.user = {};

		vm.signup = function () {

			if ( vm.user.email === undefined || vm.user.password === undefined ) {
				log.debug( 'warn', 'email & password required.' );
				return;
			}

			log.debug( 'auth', 'signing up...' );
			$http.post( ENDPOINT_URI + 'signup', vm.user )
				.then( function ( res ) {

					log.debug( 'auth', 'Registered.', res );

					authToken.setToken( res.data.token );
					$state.go( 'collection' );

				}, function ( err ) {

					log.debug( 'err', err );
					vm.form.$submitted = false;

				} );

		};

} ];
