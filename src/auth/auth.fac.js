module.exports = [ 'ENDPOINT_URI', '$http', '$q', 'authToken',
function ( ENDPOINT_URI, $http, $q, authToken ) {

		var identity = null;
		var _identityResolved = false;

		function authorize( force ) {

			var deferred = $q.defer();

			if ( force ) identity = null;

			if ( identity !== null ) {

				deferred.resolve();

			} else {

				$http.get( ENDPOINT_URI + 'auth' )
					.then( function ( res ) {

						console.log( res );
						identity = res.data;
						deferred.resolve();
						_identityResolved = true;

					}, function ( err ) {

						console.warn( err );
						// todo if jwt expired , deauthorize, remove local storage, redirect
						deferred.reject( err );
						_identityResolved = true;

					} );

			}

			return deferred.promise;

		}

		function deauthorize() {
			// when logout
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
