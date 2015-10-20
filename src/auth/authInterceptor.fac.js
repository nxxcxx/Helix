module.exports = [ 'authToken', function ( authToken ) {

	function request( config ) {

		if ( config.attachJwt ) {
			var token = authToken.getToken();
			if ( token ) {
				// http://self-issued.info/docs/draft-ietf-oauth-v2-bearer.html   section 2.1
				// https://developers.google.com/gmail/markup/actions/verifying-bearer-tokens
				// http://www.w3.org/Protocols/rfc2616/rfc2616-sec4.html section 4.2 header field name case insensitive
				config.headers.Authorization = 'Bearer ' + token;
			}
		}

		return config;

	}

	function response( res ) {
		return res;
	}

	return {

		request,
		response

	};

} ];
