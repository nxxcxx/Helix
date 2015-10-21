module.exports = [ 'log', 'ENDPOINT_URI', '$http', '$q', function ( log, ENDPOINT_URI, $http, $q ) {

	var DB_ENDPOINT = ENDPOINT_URI + 'collection';
	var collection = null;

	function create( name ) {
		// collection needs to be resolved first
		// todo check if collection is alredy exists
		collection.push( { collectionName: name, movies: [] } );
	}

	function resolveCollection() {

		var deferred = $q.defer();

		if ( collection !== null ) {
			deferred.resolve( collection );
		} else {
			$http.get( DB_ENDPOINT, { requireAuth: true } )
				.then( function ( res ) {
					log.debug( 'info', 'collection.resolveCollection():', res );
					if ( res.data ) {
						collection = res.data;
					} else {
						collection = [];
					}
					deferred.resolve( true );
				}, function ( err ) {
					log.debug( 'err', 'collection.resolveCollection():', err );
					deferred.reject( err );
				} );
		}

		return deferred.promise;

	}

	function get() {
		// $http.get( DB_ENDPOINT, { requireAuth: true } )
		// 	.then( function ( res ) {
		// 		log.debug( 'info', 'collection.get():', res );
		// 		if ( res.data ) {
		// 			collection = res.data;
		// 		} else {
		// 			collection = [];
		// 		}
		// 	}, function ( err ) {
		// 		log.debug( 'err', 'collection.get():', err );
		// 	} );
	}

	function put() {
		$http.put( DB_ENDPOINT, collection, { requireAuth: true } )
			.then( function ( res ) {
				log.debug( 'info', 'collection.put():', res );
			}, function ( err ) {
				log.debug( 'err', 'collection.put():', err );
			} );
	}

	/* collections needs to be resolved first
	update local collection
	*/
	function push( itemId, toCollection ) {
		for ( var i = 0; i < collection.length; i ++ ) {
			if ( collection[i].collectionName === toCollection ) {
				collection[i].movies.push( itemId );
				return true;
			}
		}
		return false;
	}

	function remove( itemId, fromCollection ) {
		for ( var i = 0; i < collection.length; i ++ ) {
			if ( collection[i] === fromCollection ) {
				collection.splice( i, 1 );
				return true;
			}
		}
		return false;
	}

	function sync() {
		// sync local colelction w/ DB
	}

	function getCollection() {
		return collection;
	}

	function _clear() {
		collection = null;
		log.debug( 'info', 'collection cleared.' );
	}

	return {
		getCollection,
		create,
		get,
		push,
		put,
		remove,
		sync,
		_clear,
		resolveCollection
	};

} ];
