module.exports = [ 'log', '$window', function ( log, $window ) {

	var storage = $window.localStorage;
	var cachedToken = null;

	function setToken( token ) {
		cachedToken = token;
		storage.setItem( 'jwt', token );
	}

	function getToken() {
		if ( !cachedToken ) {
			cachedToken = storage.getItem( 'jwt' );
		}
		return cachedToken;
	}

	function removeToken() {
		cachedToken = null;
		storage.removeItem( 'jwt' );
		log.debug( 'auth', 'token removed' );
	}

	function hasToken() {
		return !!getToken();
	}

	return {

		setToken,
		getToken,
		removeToken,
		hasToken

	};

} ];
