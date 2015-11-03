module.exports = [ 'log', 'ENDPOINT_URI', '$http', '$q', 'authToken',
function ( log, ENDPOINT_URI, $http, $q, authToken ) {

		var identity = null;
		var _identityResolved = false;

		function authorize( force ) {

			var deferred = $q.defer();

			if ( force ) identity = null;

			if ( identity !== null ) {

				deferred.resolve( true );

			} else {

				$http.get( ENDPOINT_URI + 'auth', { requireAuth: true } )
					.then( function ( res ) {

						log.debug( 'auth', 'auth.authorize():', res, res.data );
						identity = res.data;
						_identityResolved = true;
						deferred.resolve( true );

					}, function ( err ) {

						log.debug( 'err', 'authorize', err, err.data );
						// todo if jwt expired , deauthorize, remove local storage, redirect
						_identityResolved = true;
						deferred.reject( err );

					} );

			}

			return deferred.promise;

		}

		function deauthorize() {
			authToken.removeToken();
			identity = null;
		}

		function isAuthenticated() {
			return identity !== null;
		}

		function identityResolved() {
			return _identityResolved;
		}

		return {

			authorize,
			deauthorize,
			isAuthenticated,
			identityResolved

		};

} ];
