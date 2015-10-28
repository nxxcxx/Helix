module.exports = [ 'log', 'ENDPOINT_URI', '$http', '$q', function ( log, ENDPOINT_URI, $http, $q ) {

	var DB_ENDPOINT = ENDPOINT_URI + 'collection';
	var collection = null;

	var fullCollection = null;

	function create( name ) {
		collection.push( { collectionName: name, movies: [] } );
		put();
	}

	function isEmpty() {
		return collection.length === 0;
	}

	function fetchAll( collectionName ) {
		
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
					log.debug( 'warn', 'collection.resolveCollection():', err );
					deferred.reject( err );
				} );
		}

		return deferred.promise;

	}

	function hasItem( itemId, someCollection ) {
		for ( var i = 0; i < collection.length; i ++ ) {
			if ( collection[i].collectionName === someCollection ) {
				for ( var k = 0; k < collection[i].movies.length; k ++ ) {
					if ( collection[i].movies[k] === itemId ) {
						return true;
					}
				}
			}
		}
		return false;
	}

	function put() {
		$http.put( DB_ENDPOINT, collection, { requireAuth: true } )
			.then( function ( res ) {
				log.debug( 'info', 'collection.put():', res );
			}, function ( err ) {
				log.debug( 'err', 'collection.put():', err );
			} );
	}

	function push( itemId, toCollection ) {
		if ( hasItem( itemId, toCollection ) ) {
			return false;
		}
		for ( var i = 0; i < collection.length; i ++ ) {
			if ( collection[i].collectionName === toCollection ) {
				collection[i].movies.push( itemId );
				put();
				return true;
			}
		}
		return false;
	}

	function remove( itemId, inCollection ) {
		for ( var i = 0; i < collection.length; i ++ ) {
			if ( collection[i].collectionName === inCollection ) {
				for ( var k = 0; k < collection[i].movies.length; k ++ ) {
					if ( collection[i].movies[k] === itemId ) {
						var removed = collection[i].movies.splice( k, 1 ).length;
						put();
						return removed !== 0;
					}
				}
			}
		}
		return false;
	}

	function removeCollection( collectionName ) {
		for ( var i = 0; i < collection.length; i ++ ) {
			if ( collection[i].collectionName === collectionName ) {
				var removed = collection.splice( i, 1 ).length;
				put();
				return removed !== 0;
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
		log.debug( 'info', 'local collection cleared.' );
	}

	return {
		getCollection,
		create,
		push,
		put,
		remove,
		removeCollection,
		sync,
		_clear,
		resolveCollection,
		hasItem,
		isEmpty
	};

} ];
