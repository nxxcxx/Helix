(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

module.exports = ['log', '$http', 'TMDB_API', 'EVT', '$cacheFactory', '$q', 'ENDPOINT_URI', function (log, $http, TMDB_API, EVT, $cacheFactory, $q, ENDPOINT_URI) {

	var searchResult = [];
	var prevResultLen = 0;
	var totalPages = -1;
	var currPage = 1;

	var movieIdCache = $cacheFactory('movieIdCache');
	// TMDB_API.url + 'movie/now_playing'

	var DB_ENDPOINT = ENDPOINT_URI + 'movie/';

	function putItemToDB(movieItem) {
		// todo dont put exisiting item in db ( UPSERT )
		$http.put(DB_ENDPOINT + movieItem.id, movieItem).then(function (res) {
			log.debug('info', 'PUT:', res);
		}, function (err) {
			log.debug('err', 'PUT:', err);
		});
	}

	function searchIdFromDB(id) {
		var promise = $http.get(DB_ENDPOINT + id).then(function (res) {
			log.debug('info', 'searchById => DB:', res.data);
			if (res.data) {
				return res.data;
			} else {
				return null;
			}
		}, function (err) {
			log.debug('err', 'searchById => DB:', err);
		});
		return promise;
	}

	function searchIdFromAPI(id) {
		var promise = $http.get(TMDB_API.url + 'movie/' + id, {
			params: { api_key: TMDB_API.key }
		}).then(function (res) {
			log.debug('info', 'searchById => API:', res.data);
			movieIdCache.put(res.data.id, res.data);
			putItemToDB(res.data);
			return res.data;
		}, function (err) {
			log.debug('err', 'searchById => API:', err);
		});
		return promise;
	}

	function searchById(id) {

		var cachedItem = movieIdCache.get(id);
		if (cachedItem) {
			log.debug('info', 'searchById => cache:', cachedItem);
			return cachedItem;
		}

		var df_DB = $q.defer();
		var df_Res = $q.defer();

		searchIdFromDB(id).then(function (res) {
			if (res) {
				df_DB.resolve(res);
			} else {
				df_DB.reject('not found');
			}
		}, function (err) {
			df_DB.reject(err);
		});

		df_DB.promise.then(function (res_DB) {
			df_Res.resolve(res_DB);
		}, function (err) {
			searchIdFromAPI(id).then(function (res_api) {
				df_Res.resolve(res_api);
			}, function (err_api) {
				df_Res.reject(err_api);
			});
		});

		return df_Res.promise;
	}

	function searchByTitle(searchObj) {

		if (currPage > totalPages && totalPages !== -1) {
			// emit event end of page
			EVT.EOP.emit();
			return;
		}

		$http({
			method: 'GET',
			cache: true,
			url: TMDB_API.url + 'search/movie',
			params: {
				api_key: TMDB_API.key,
				query: searchObj.query,
				page: currPage
			}
		}).then(function (res) {
			// emit event search success
			searchResult = searchResult.concat(removeNoPosterItems(res.data.results));
			totalPages = res.data.total_pages;
			currPage++;
			prevResultLen = searchResult.length;
			log.debug('info', 'searchByTitle:', res, res.data);

			// cache
			res.data.results.forEach(function (item) {

				if (!movieIdCache.get(item.id)) {
					movieIdCache.put(item.id, item);
					// putItemToDB( item ); // todo check if already exits in DB
				}
			});
		}, function (err) {
			// emit event search err
			log.debug('searchByTitle:', err);
		});
	}

	function removeNoPosterItems(results) {
		return results.filter(function (item) {
			return !!item.poster_path;
		});
	}

	function getRes() {
		return searchResult;
	}

	function clearSearch() {
		// emit event clearSeach
		searchResult.length = 0;
		prevResultLen = 0;
		totalPages = -1;
		currPage = 1;
	}

	return {
		searchByTitle: searchByTitle,
		searchById: searchById,
		clearSearch: clearSearch,
		getRes: getRes,
		prevResultLen: prevResultLen,
		putItemToDB: putItemToDB
	};
}];

},{}],2:[function(require,module,exports){
'use strict';

module.exports = ['log', 'ENDPOINT_URI', '$http', '$q', 'authToken', function (log, ENDPOINT_URI, $http, $q, authToken) {

	var identity = null;
	var _identityResolved = false;

	function authorize(force) {

		var deferred = $q.defer();

		if (force) identity = null;

		if (identity !== null) {

			deferred.resolve(true);
		} else {

			$http.get(ENDPOINT_URI + 'auth', { requireAuth: true }).then(function (res) {

				log.debug('info', 'auth.authorize():', res, res.data);
				identity = res.data;
				_identityResolved = true;
				deferred.resolve(true);
			}, function (err) {

				log.debug('warn', 'authorize', err, err.data);
				// todo if jwt expired , deauthorize, remove local storage, redirect
				_identityResolved = true;
				deferred.reject(err);
			});
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

		authorize: authorize,
		deauthorize: deauthorize,
		isAuthenticated: isAuthenticated,
		identityResolved: identityResolved

	};
}];

},{}],3:[function(require,module,exports){
'use strict';

module.exports = ['authToken', function (authToken) {

	function request(config) {

		if (config.requireAuth) {
			var token = authToken.getToken();
			if (token) {
				// http://self-issued.info/docs/draft-ietf-oauth-v2-bearer.html   section 2.1
				// https://developers.google.com/gmail/markup/actions/verifying-bearer-tokens
				// http://www.w3.org/Protocols/rfc2616/rfc2616-sec4.html section 4.2 header field name case insensitive
				config.headers.Authorization = 'Bearer ' + token;
			}
		}

		return config;
	}

	function response(res) {
		return res;
	}

	return {

		request: request,
		response: response

	};
}];

},{}],4:[function(require,module,exports){
'use strict';

module.exports = ['log', '$window', function (log, $window) {

	var storage = $window.localStorage;
	var cachedToken = null;

	function setToken(token) {
		cachedToken = token;
		storage.setItem('jwt', token);
	}

	function getToken() {
		if (!cachedToken) {
			cachedToken = storage.getItem('jwt');
		}
		return cachedToken;
	}

	function removeToken() {
		cachedToken = null;
		storage.removeItem('jwt');
		log.debug('info', 'token removed');
	}

	function hasToken() {
		return !!getToken();
	}

	return {

		setToken: setToken,
		getToken: getToken,
		removeToken: removeToken,
		hasToken: hasToken

	};
}];

},{}],5:[function(require,module,exports){
'use strict';

module.exports = ['$scope', 'auth', 'movieCollection', function ($scope, auth, movieCollection) {

	window.movieCollection = movieCollection;
	console.log(movieCollection.getCollection());
}];

},{}],6:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', '$http', 'ENDPOINT_URI', 'authToken', '$state', function (log, $scope, $http, ENDPOINT_URI, authToken, $state) {

	var vm = this;
	vm.user = {
		email: '',
		password: ''
	};

	vm.signin = function () {

		if (vm.user.email === '' || vm.user.password === '') {
			log.debug('warn', 'email & password required.');
			return;
		}

		$http.post(ENDPOINT_URI + 'signin', vm.user).then(function (res) {
			log.debug('info', 'signin', res, res.data);
			authToken.setToken(res.data.token);
			$state.go('collection');
		}, function (err, status) {
			log.debug('warn', 'signin', err);
		});
	};
}];

},{}],7:[function(require,module,exports){
'use strict';

module.exports = ['$state', 'auth', 'movieCollection', function ($state, auth, movieCollection) {

	auth.deauthorize();
	movieCollection._clear();
	$state.go('signin');
}];

},{}],8:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', '$http', 'ENDPOINT_URI', 'authToken', '$state', function (log, $scope, $http, ENDPOINT_URI, authToken, $state) {

	var vm = this;
	vm.user = {};

	vm.signup = function () {

		if (vm.user.email === undefined || vm.user.password === undefined) {
			log.debug('warn', 'email & password required.');
			return;
		}

		log.debug('warn', 'signing up...');
		$http.post(ENDPOINT_URI + 'signup', vm.user).then(function (res) {

			log.debug('info', 'Registered.');
			log.debug('info', res);

			authToken.setToken(res.data.token);
			$state.go('collection');
		}, function (err) {

			log.debug('warn', err);
			vm.form.$submitted = false;
		});
	};
}];

},{}],9:[function(require,module,exports){
'use strict';

module.exports = [function () {

	var debugEnabled = false;
	var debugNamespaces = [];

	this.enableDebug = function () {
		debugEnabled = true;
	};

	this.enableDebugNamespace = function () {
		for (var i = 0; i < arguments.length; i++) {
			debugNamespaces.push(arguments[i]);
		}
	};

	this.$get = function () {

		function debug() {
			if (!debugEnabled) return;
			var debugName = arguments[0];
			var slicedArgs = Array.prototype.slice.call(arguments, 1);
			if (debugName === 'err') {
				console.error.apply(console, slicedArgs);
			} else if (debugName === 'info') {
				console.info.apply(console, slicedArgs);
			} else if (debugName === 'warn') {
				console.warn.apply(console, slicedArgs);
			} else if (debugNamespaces.indexOf(debugName) !== -1) {
				console.log.apply(console, slicedArgs);
			}
		}

		return {
			debug: debug
		};
	};
}];

},{}],10:[function(require,module,exports){
'use strict';

module.exports = ['$rootScope', function ($rootScope) {

	var EVT = {

		EOP: {
			listen: function listen(cb) {
				$rootScope.$on('EOP', cb);
			},
			emit: function emit() {
				$rootScope.$broadcast('EOP');
			}
		}

	};

	return EVT;
}];

},{}],11:[function(require,module,exports){
'use strict';

module.exports = ['$window', 'ENGINE', 'util', function ($window, ENGINE, util) {

	function ctrl($scope, $element) {

		ENGINE.attachRenderer($element);
		$($window).on('resize', util.debounce(ENGINE.onWindowResize, 100));
		$element.on('wheel', function (evt) {
			ENGINE.$$.wheel_dy = -Math.sign(evt.originalEvent.deltaY);
		});

		ENGINE.start();
	}

	return {
		restrict: 'E',
		replace: true,
		controller: ctrl,
		template: '<div id="canvas-container"></div>'
	};
}];

},{}],12:[function(require,module,exports){
'use strict';

module.exports = ['$window', function ($window) {

	var $$ = {
		canvas: null,
		stats: new Stats(),
		scene: new THREE.Scene(),
		width: $window.innerWidth,
		height: $window.innerHeight,
		camera: new THREE.PerspectiveCamera(70, this.width / this.height, 10, 100000),
		renderer: new THREE.CSS3DRenderer(),
		screen_ratio: this.width / this.height,
		pixel_ratio: $window.devicePixelRatio || 1,
		mouse_x: this.width * 0.5,
		mouse_y: this.height * 0.5,
		wheel_dy: 0
	};

	$$.renderer.setSize($$.width, $$.height);

	function attachRenderer(canvas) {
		$$.canvas = canvas;
		canvas.append($$.renderer.domElement);
		canvas.append($$.stats.domElement);
	}

	function onWindowResize() {
		$$.width = $window.innerWidth;
		$$.height = $window.innerHeight;
		$$.pixel_ratio = $window.devicePixelRatio || 1;
		$$.screen_ratio = $$.width / $$.height;
		$$.camera.aspect = $$.screen_ratio;
		$$.camera.updateProjectionMatrix();
		$$.renderer.setSize($$.width, $$.height);
	}

	function setup() {}

	function update() {

		if (Math.abs($$.wheel_dy) > 0.001) {
			$$.camera.position.y += $$.wheel_dy * 1.0;
			$$.camera.rotateY($$.wheel_dy * 0.025);
			$$.wheel_dy *= 0.95;
		}
	}

	// ----  draw loop
	function run() {

		requestAnimationFrame(run);
		update();
		$$.renderer.render($$.scene, $$.camera);
		$$.stats.update();
	}

	function start() {
		setup();
		run();
	}

	function resetCamera() {
		$$.camera.position.set(0, 0, 0);
		$$.camera.rotation.set(0, 0, 0);
	}

	return {
		$$: $$,
		attachRenderer: attachRenderer,
		onWindowResize: onWindowResize,
		start: start,
		resetCamera: resetCamera
	};
}];

},{}],13:[function(require,module,exports){
'use strict';

module.exports = ['log', 'ENGINE', '$compile', '$rootScope', function (log, ENGINE, $compile, $rootScope) {

	var allPosters = new THREE.Object3D();
	ENGINE.$$.scene.add(allPosters);

	function makeHelixPosters(posterObjectMulti, offsetStartIdx) {

		var vector = new THREE.Vector3();
		var radius = 900;
		for (var i = 0; i < posterObjectMulti.length; i++) {

			var $isolatedScope = $rootScope.$new(true);
			$isolatedScope.movieItem = posterObjectMulti[i];

			var posterDirectiveElem = $compile('<poster></poster>')($isolatedScope)[0];
			var css3dObj = new THREE.CSS3DObject(posterDirectiveElem);

			// tag alog an isolatedScope to be destroy when dispose an element
			css3dObj.scope = $isolatedScope;

			var hidx = i + offsetStartIdx;
			var phi = hidx * 0.175 + Math.PI;
			css3dObj.position.x = -radius * Math.sin(phi);
			css3dObj.position.y = -(hidx * 8) + 200;
			css3dObj.position.z = radius * Math.cos(phi);

			vector.set(-css3dObj.position.x * 2, css3dObj.position.y, -css3dObj.position.z * 2);

			css3dObj.lookAt(vector);
			allPosters.add(css3dObj);
		}

		log.debug('info', 'curr posters:', allPosters.children.length);
	}

	function clearAll() {
		allPosters.children.forEach(function (poster) {
			poster.disposeElement();
			poster.scope.$destroy();
		});
		allPosters.children.length = 0; // clear items
	}

	return {
		makeHelixPosters: makeHelixPosters,
		clearAll: clearAll
	};
}];

},{}],14:[function(require,module,exports){
'use strict';

module.exports = ['$state', function ($state) {

	function ctrl($scope, $element) {

		// $scope.movieItem obj is passed thru isolatedScope via compiled directive in helix.fac.js

		var img = new Image();
		var imgUrl = 'http://image.tmdb.org/t/p/w154/' + $scope.movieItem.poster_path;
		img.onload = function () {

			// todo move css into sass, use class instead
			$element.css({
				'width': '150px',
				'height': '230px',
				'background-repeat': 'no-repeat',
				'background-size': '150px 230px',
				'background-image': 'url(' + imgUrl + ')',
				'display': 'none' // required for fadeIn animation
			});
			$element.fadeIn(1500);
		};
		img.src = imgUrl;

		$element.on('click', function (evt) {
			$state.go('movieDetail', { movieId: $scope.movieItem.id });
		});
	}

	return {
		restrict: 'E',
		replace: true,
		controller: ctrl,
		template: '<div class="posterElem"></div>'
	};
}];

},{}],15:[function(require,module,exports){
'use strict';

angular.module('app', ['ui.router', 'ngAnimate']).constant('ENDPOINT_URI', 'http://localhost:8001/').constant('TMDB_API', {
	key: '374c0342a6406dfe0aeb3de2ea042c59',
	url: 'http://api.themoviedb.org/3/'
}).provider('log', require('./debug/log.pv.js')).factory('util', require('./util.js')).controller('mainCtrl', require('./main.ctrl.js')).factory('TMDb', require('./TMDb.fac.js')).factory('EVT', require('./events.fac.js')).controller('movieDetailCtrl', require('./movieDetail.ctrl.js')).directive('display', require('./helix/display.dir.js')).factory('ENGINE', require('./helix/engine.fac.js')).factory('helix', require('./helix/helix.fac.js')).directive('poster', require('./helix/poster.dir.js')).controller('signupCtrl', require('./auth/signup.ctrl.js')).controller('signinCtrl', require('./auth/signin.ctrl.js')).controller('signoutCtrl', require('./auth/signout.ctrl.js')).controller('collectionCtrl', require('./auth/collection.ctrl.js')).factory('auth', require('./auth/auth.fac.js')).factory('authToken', require('./auth/authToken.fac.js')).factory('authInterceptor', require('./auth/authInterceptor.fac.js')).factory('movieCollection', require('./movieCollection.fac.js')).config(['$stateProvider', '$urlRouterProvider', '$httpProvider', function ($stateProvider, $urlRouterProvider, $httpProvider) {

	$urlRouterProvider.otherwise('/');

	$stateProvider.state('home', {
		url: '/',
		templateUrl: './template/home.html'
	}).state('movieDetail', {
		url: '/movie/:movieId',
		templateUrl: './template/movie.html',
		controller: 'movieDetailCtrl',
		controllerAs: 'md',
		resolve: {
			movieItem: ['$stateParams', 'TMDb', function ($stateParams, TMDb) {
				return TMDb.searchById($stateParams.movieId);
			}]
		}
	}).state('signup', {
		url: '/signup',
		templateUrl: './template/signup.html',
		controller: 'signupCtrl',
		controllerAs: 'signup'
	}).state('signin', {
		url: '/signin',
		templateUrl: './template/signin.html',
		controller: 'signinCtrl',
		controllerAs: 'signin'
	}).state('signout', {
		url: '/signout',
		controller: 'signoutCtrl'
	}).state('collection', {
		url: '/collection',
		templateUrl: './template/collection.html',
		controller: 'collectionCtrl',
		controllerAs: 'coll',
		resolve: {
			authorize: ['auth', function (auth) {
				return auth.authorize();
			}],
			resolvedCollection: ['movieCollection', function (movieCollection) {
				return movieCollection.resolveCollection();
			}]
		}
	});

	$httpProvider.interceptors.push('authInterceptor');
}]).run(['log', '$rootScope', '$state', 'auth', function (log, $rootScope, $state, auth) {

	// todo authorize user every beginning of session
	// todo dont autorize twice
	auth.authorize(true);

	$rootScope.$on('$stateChangeError', function (event, toState, toParams, fromState, fromParams, error) {

		event.preventDefault(); // prevent transition
		log.debug('warn', error);
		if (error) {
			$state.go('signin');
		}
	});
}]).config(['logProvider', '$httpProvider', function (logProvider, $httpProvider) {

	logProvider.enableDebug();
	logProvider.enableDebugNamespace('info', 'err', 'auth'); // ctrl

	$httpProvider.useLegacyPromiseExtensions(false);
}]);

},{"./TMDb.fac.js":1,"./auth/auth.fac.js":2,"./auth/authInterceptor.fac.js":3,"./auth/authToken.fac.js":4,"./auth/collection.ctrl.js":5,"./auth/signin.ctrl.js":6,"./auth/signout.ctrl.js":7,"./auth/signup.ctrl.js":8,"./debug/log.pv.js":9,"./events.fac.js":10,"./helix/display.dir.js":11,"./helix/engine.fac.js":12,"./helix/helix.fac.js":13,"./helix/poster.dir.js":14,"./main.ctrl.js":16,"./movieCollection.fac.js":17,"./movieDetail.ctrl.js":18,"./util.js":19}],16:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', 'TMDb', 'EVT', 'helix', 'ENGINE', 'auth', function (log, $scope, TMDb, EVT, helix, ENGINE, auth) {

	var vm = this;
	vm.auth = auth;
	vm.search = {
		query: ''
	};
	vm.movieItems = null;

	$scope.$watch(TMDb.getRes, function (movItems) {

		vm.movieItems = movItems;
		helix.makeHelixPosters(movItems.slice(TMDb.prevResultLen), TMDb.prevResultLen);
	}, true);

	var prevQuery = '';
	vm.search = function () {
		if (vm.search.query === '') return;
		if (prevQuery !== vm.search.query) {
			prevQuery = vm.search.query;
			TMDb.clearSearch();
			helix.clearAll();
			ENGINE.resetCamera();
		}
		TMDb.searchByTitle(vm.search);
	};

	// DEBUG
	window.SCOPE = $scope;
	vm.TMDb = TMDb;
	vm.helix = helix;
	vm.ENGINE = ENGINE;

	EVT.EOP.listen(function () {
		log.debug('info', 'recieved EOP event!');
	});
}];

},{}],17:[function(require,module,exports){
'use strict';

module.exports = ['log', 'ENDPOINT_URI', '$http', '$q', function (log, ENDPOINT_URI, $http, $q) {

	var DB_ENDPOINT = ENDPOINT_URI + 'collection';
	var collection = null;

	function create(name) {
		// collection needs to be resolved first
		// todo check if collection is alredy exists
		collection.push({ collectionName: name, movies: [] });
	}

	function resolveCollection() {

		var deferred = $q.defer();

		if (collection !== null) {
			deferred.resolve(collection);
		} else {
			$http.get(DB_ENDPOINT, { requireAuth: true }).then(function (res) {
				log.debug('info', 'collection.resolveCollection():', res);
				if (res.data) {
					collection = res.data;
				} else {
					collection = [];
				}
				deferred.resolve(true);
			}, function (err) {
				log.debug('err', 'collection.resolveCollection():', err);
				deferred.reject(err);
			});
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
		$http.put(DB_ENDPOINT, collection, { requireAuth: true }).then(function (res) {
			log.debug('info', 'collection.put():', res);
		}, function (err) {
			log.debug('err', 'collection.put():', err);
		});
	}

	/* collections needs to be resolved first
 update local collection
 */
	function push(itemId, toCollection) {
		for (var i = 0; i < collection.length; i++) {
			if (collection[i].collectionName === toCollection) {
				collection[i].movies.push(itemId);
				return true;
			}
		}
		return false;
	}

	function remove(itemId, fromCollection) {
		for (var i = 0; i < collection.length; i++) {
			if (collection[i] === fromCollection) {
				collection.splice(i, 1);
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
		log.debug('info', 'collection cleared.');
	}

	return {
		getCollection: getCollection,
		create: create,
		get: get,
		push: push,
		put: put,
		remove: remove,
		sync: sync,
		_clear: _clear,
		resolveCollection: resolveCollection
	};
}];

},{}],18:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', 'TMDb', '$cacheFactory', 'movieItem', function (log, $scope, TMDb, $cacheFactory, movieItem) {

	var vm = this;
	vm.movieItem = movieItem; // movieItem injected via state resolve
	log.debug('ctrl', 'movieDetail ctrl resolved:', vm.movieItem);

	movieItem.fullTitle = movieItem.title;
	if (movieItem.title !== movieItem.original_title) {
		movieItem.fullTitle = movieItem.title + ' (' + movieItem.original_title + ')';
	}

	if (movieItem.backdrop_path) {
		var imgUrl = 'http://image.tmdb.org/t/p/original' + movieItem.backdrop_path;
		$('.backdrop').css({
			'background-image': 'url(' + imgUrl + ')'
		});
	}

	vm.addToCollection = function () {
		console.log(movieItem.id);
		// prompt up collection modal -> fetch usr's collection -> allow user to select which collection to add to -> save to DB
	};
}];

},{}],19:[function(require,module,exports){
"use strict";

module.exports = [function () {

	function debounce(func, wait, immediate) {
		var _this = this,
		    _arguments = arguments;

		var timeout;
		return function () {

			var context = _this,
			    args = _arguments;
			var later = function later() {

				timeout = null;
				if (!immediate) func.apply(context, args);
			};
			var callNow = immediate && !timeout;
			clearTimeout(timeout);
			timeout = setTimeout(later, wait);
			if (callNow) func.apply(context, args);
		};
	}

	return {
		debounce: debounce
	};
}];

},{}]},{},[15])
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9UTURiLmZhYy5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2F1dGgvYXV0aC5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL2F1dGhJbnRlcmNlcHRvci5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL2F1dGhUb2tlbi5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL2NvbGxlY3Rpb24uY3RybC5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2F1dGgvc2lnbmluLmN0cmwuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL3NpZ25vdXQuY3RybC5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2F1dGgvc2lnbnVwLmN0cmwuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9kZWJ1Zy9sb2cucHYuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9ldmVudHMuZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvaGVsaXgvZGlzcGxheS5kaXIuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9oZWxpeC9lbmdpbmUuZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvaGVsaXgvaGVsaXguZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvaGVsaXgvcG9zdGVyLmRpci5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2luZGV4LmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvbWFpbi5jdHJsLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvbW92aWVDb2xsZWN0aW9uLmZhYy5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL21vdmllRGV0YWlsLmN0cmwuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy91dGlsLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7QUNBQSxNQUFNLENBQUMsT0FBTyxHQUFHLENBQUUsS0FBSyxFQUFFLE9BQU8sRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFFLGVBQWUsRUFBRSxJQUFJLEVBQUUsY0FBYyxFQUMzRixVQUFXLEdBQUcsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLEdBQUcsRUFBRSxhQUFhLEVBQUUsRUFBRSxFQUFFLFlBQVksRUFBRzs7QUFFdkUsS0FBSSxZQUFZLEdBQUcsRUFBRSxDQUFDO0FBQ3RCLEtBQUksYUFBYSxHQUFHLENBQUMsQ0FBQztBQUN0QixLQUFJLFVBQVUsR0FBRyxDQUFDLENBQUMsQ0FBQztBQUNwQixLQUFJLFFBQVEsR0FBRyxDQUFDLENBQUM7O0FBRWpCLEtBQUksWUFBWSxHQUFHLGFBQWEsQ0FBRSxjQUFjLENBQUUsQ0FBQzs7O0FBR25ELEtBQUksV0FBVyxHQUFHLFlBQVksR0FBRyxRQUFRLENBQUM7O0FBRTFDLFVBQVMsV0FBVyxDQUFFLFNBQVMsRUFBRzs7QUFFakMsT0FBSyxD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U0FBUyxLQUFLLEdBQUc7O0FBRTVCLFdBQU8sR0FBRyxJQUFJLENBQUM7QUFDZixRQUFLLENBQUMsU0FBUyxFQUFHLElBQUksQ0FBQyxLQUFLLENBQUUsT0FBTyxFQUFFLElBQUksQ0FBRSxDQUFDO0lBQzlDLENBQUM7QUFDRixPQUFJLE9BQU8sR0FBRyxTQUFTLElBQUksQ0FBQyxPQUFPLENBQUM7QUFDcEMsZUFBWSxDQUFFLE9BQU8sQ0FBRSxDQUFDO0FBQ3hCLFVBQU8sR0FBRyxVQUFVLENBQUUsS0FBSyxFQUFFLElBQUksQ0FBRSxDQUFDO0FBQ3BDLE9BQUssT0FBTyxFQUFHLElBQUksQ0FBQyxLQUFLLENBQUUsT0FBTyxFQUFFLElBQUksQ0FBRSxDQUFDO0dBQzNDLENBQUM7RUFDRjs7QUFFRCxRQUFPO0FBQ04sVUFBUSxFQUFSLFFBQVE7RUFDUixDQUFDO0NBRUYsQ0FBRSxDQUFDIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJyRodHRwJywgJ1RNREJfQVBJJywgJ0VWVCcsICckY2FjaGVGYWN0b3J5JywgJyRxJywgJ0VORFBPSU5UX1VSSScsXHJcbmZ1bmN0aW9uICggbG9nLCAkaHR0cCwgVE1EQl9BUEksIEVWVCwgJGNhY2hlRmFjdG9yeSwgJHEsIEVORFBPSU5UX1VSSSApIHtcclxuXHJcblx0dmFyIHNlYXJjaFJlc3VsdCA9IFtdO1xyXG5cdHZhciBwcmV2UmVzdWx0TGVuID0gMDtcclxuXHR2YXIgdG90YWxQYWdlcyA9IC0xO1xyXG5cdHZhciBjdXJyUGFnZSA9IDE7XHJcblxyXG5cdHZhciBtb3ZpZUlkQ2FjaGUgPSAkY2FjaGVGYWN0b3J5KCAnbW92aWVJZENhY2hlJyApO1xyXG5cdC8vIFRNREJfQVBJLnVybCArICdtb3ZpZS9ub3dfcGxheWluZydcclxuXHJcblx0dmFyIERCX0VORFBPSU5UID0gRU5EUE9JTlRfVVJJICsgJ21vdmllLyc7XHJcblxyXG5cdGZ1bmN0aW9uIHB1dEl0ZW1Ub0RCKCBtb3ZpZUl0ZW0gKSB7XHJcblx0XHQvLyB0b2RvIGRvbnQgcHV0IGV4aXNpdGluZyBpdGVtIGluIGRiICggVVBTRVJUIClcclxuXHRcdCRodHRwLnB1dCggREJfRU5EUE9JTlQgKyBtb3ZpZUl0ZW0uaWQsIG1vdmllSXRlbSApXHJcblx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnUFVUOicsIHJlcyApO1xyXG5cdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdQVVQ6JywgZXJyICk7XHJcblx0XHR9ICk7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBzZWFyY2hJZEZyb21EQiggaWQgKSB7XHJcblx0XHR2YXIgcHJvbWlzZSA9ICRodHRwLmdldCggREJfRU5EUE9JTlQgKyBpZCApXHJcblx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnc2VhcmNoQnlJZCA9PiBEQjonLCByZXMuZGF0YSApO1xyXG5cdFx0XHRpZiAoIHJlcy5kYXRhICkge1xyXG5cdFx0XHRcdHJldHVybiByZXMuZGF0YTtcclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRyZXR1cm4gbnVsbDtcclxuXHRcdFx0fVxyXG5cdFx0fSwgZnVuY3Rpb24oIGVyciApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ3NlYXJjaEJ5SWQgPT4gREI6JywgZXJyICk7XHJcblx0XHR9ICk7XHJcblx0XHRyZXR1cm4gcHJvbWlzZTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIHNlYXJjaElkRnJvbUFQSSggaWQgKSB7XHJcblx0XHR2YXIgcHJvbWlzZSA9ICRodHRwLmdldCggVE1EQl9BUEkudXJsICsgJ21vdmllLycgKyBpZCwge1xyXG5cdFx0XHRwYXJhbXM6IHsgYXBpX2tleTogVE1EQl9BUEkua2V5IH1cclxuXHRcdH0gKS50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnaW5mbycsICdzZWFyY2hCeUlkID0+IEFQSTonLCByZXMuZGF0YSApO1xyXG5cdFx0XHRtb3ZpZUlkQ2FjaGUucHV0KCByZXMuZGF0YS5pZCwgcmVzLmRhdGEgKTtcclxuXHRcdFx0cHV0SXRlbVRvREIoIHJlcy5kYXRhICk7XHJcblx0XHRcdHJldHVybiByZXMuZGF0YTtcclxuXHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdlcnInLCAnc2VhcmNoQnlJZCA9PiBBUEk6JywgZXJyICk7XHJcblx0XHR9ICk7XHJcblx0XHRyZXR1cm4gcHJvbWlzZTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIHNlYXJjaEJ5SWQoIGlkICkge1xyXG5cclxuXHRcdHZhciBjYWNoZWRJdGVtID0gbW92aWVJZENhY2hlLmdldCggaWQgKTtcclxuXHRcdGlmICggY2FjaGVkSXRlbSApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnaW5mbycsICdzZWFyY2hCeUlkID0+IGNhY2hlOicsIGNhY2hlZEl0ZW0gKTtcclxuXHRcdFx0cmV0dXJuIGNhY2hlZEl0ZW07XHJcblx0XHR9XHJcblxyXG5cdFx0dmFyIGRmX0RCID0gJHEuZGVmZXIoKTtcclxuXHRcdHZhciBkZl9SZXMgPSAkcS5kZWZlcigpO1xyXG5cclxuXHRcdHNlYXJjaElkRnJvbURCKCBpZCApLnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cdFx0XHRpZiAoIHJlcyApIHtcclxuXHRcdFx0XHRkZl9EQi5yZXNvbHZlKCByZXMgKTtcclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRkZl9EQi5yZWplY3QoICdub3QgZm91bmQnICk7XHJcblx0XHRcdH1cclxuXHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xyXG5cdFx0XHRcdGRmX0RCLnJlamVjdCggZXJyICk7XHJcblx0XHR9ICk7XHJcblxyXG5cdFx0ZGZfREIucHJvbWlzZS50aGVuKCBmdW5jdGlvbiAoIHJlc19EQiApIHtcclxuXHRcdFx0ZGZfUmVzLnJlc29sdmUoIHJlc19EQiApO1xyXG5cdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XHJcblx0XHRcdHNlYXJjaElkRnJvbUFQSSggaWQgKS50aGVuKCBmdW5jdGlvbiAoIHJlc19hcGkgKSB7XHJcblx0XHRcdFx0ZGZfUmVzLnJlc29sdmUoIHJlc19hcGkgKTtcclxuXHRcdFx0fSwgZnVuY3Rpb24gKCBlcnJfYXBpICkge1xyXG5cdFx0XHRcdGRmX1Jlcy5yZWplY3QoIGVycl9hcGkgKTtcclxuXHRcdFx0fSApO1xyXG5cdFx0fSApO1xyXG5cclxuXHRcdHJldHVybiBkZl9SZXMucHJvbWlzZTtcclxuXHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBzZWFyY2hCeVRpdGxlKCBzZWFyY2hPYmogKSB7XHJcblxyXG5cdFx0aWYgKCBjdXJyUGFnZSA+IHRvdGFsUGFnZXMgJiYgdG90YWxQYWdlcyAhPT0gLTEgKSB7XHJcblx0XHRcdC8vIGVtaXQgZXZlbnQgZW5kIG9mIHBhZ2VcclxuXHRcdFx0RVZULkVPUC5lbWl0KCk7XHJcblx0XHRcdHJldHVybjtcclxuXHRcdH1cclxuXHJcblx0XHQkaHR0cCgge1xyXG5cdFx0XHRtZXRob2Q6ICdHRVQnLFxyXG5cdFx0XHRjYWNoZTogdHJ1ZSxcclxuXHRcdFx0dXJsOiBUTURCX0FQSS51cmwgKyAnc2VhcmNoL21vdmllJyxcclxuXHRcdFx0cGFyYW1zOntcclxuXHRcdFx0XHRhcGlfa2V5OiBUTURCX0FQSS5rZXksXHJcblx0XHRcdFx0cXVlcnk6IHNlYXJjaE9iai5xdWVyeSxcclxuXHRcdFx0XHRwYWdlOiBjdXJyUGFnZVxyXG5cdFx0XHR9XHJcblx0XHR9ICkudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblx0XHRcdC8vIGVtaXQgZXZlbnQgc2VhcmNoIHN1Y2Nlc3NcclxuXHRcdFx0c2VhcmNoUmVzdWx0ID0gc2VhcmNoUmVzdWx0LmNvbmNhdCggcmVtb3ZlTm9Qb3N0ZXJJdGVtcyggcmVzLmRhdGEucmVzdWx0cyApICk7XHJcblx0XHRcdHRvdGFsUGFnZXMgPSByZXMuZGF0YS50b3RhbF9wYWdlcztcclxuXHRcdFx0Y3VyclBhZ2UgKys7XHJcblx0XHRcdHByZXZSZXN1bHRMZW4gPSBzZWFyY2hSZXN1bHQubGVuZ3RoO1xyXG5cdFx0XHRsb2cuZGVidWcoICdpbmZvJywgJ3NlYXJjaEJ5VGl0bGU6JywgcmVzLCByZXMuZGF0YSApO1xyXG5cclxuXHRcdFx0Ly8gY2FjaGVcclxuXHRcdFx0cmVzLmRhdGEucmVzdWx0cy5mb3JFYWNoKCBmdW5jdGlvbiAoIGl0ZW0gKSB7XHJcblxyXG5cdFx0XHRcdGlmICggIW1vdmllSWRDYWNoZS5nZXQoIGl0ZW0uaWQgKSApIHtcclxuXHRcdFx0XHRcdG1vdmllSWRDYWNoZS5wdXQoIGl0ZW0uaWQsIGl0ZW0gKTtcclxuXHRcdFx0XHRcdC8vIHB1dEl0ZW1Ub0RCKCBpdGVtICk7IC8vIHRvZG8gY2hlY2sgaWYgYWxyZWFkeSBleGl0cyBpbiBEQlxyXG5cdFx0XHRcdH1cclxuXHJcblx0XHRcdH0gKTtcclxuXHJcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0Ly8gZW1pdCBldmVudCBzZWFyY2ggZXJyXHJcblx0XHRcdGxvZy5kZWJ1ZyggJ3NlYXJjaEJ5VGl0bGU6JywgZXJyICk7XHJcblx0XHR9ICk7XHJcblxyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gcmVtb3ZlTm9Qb3N0ZXJJdGVtcyggcmVzdWx0cyApIHtcclxuXHRcdHJldHVybiByZXN1bHRzLmZpbHRlciggZnVuY3Rpb24gKCBpdGVtICkge1xyXG5cdFx0XHRyZXR1cm4gISFpdGVtLnBvc3Rlcl9wYXRoO1xyXG5cdFx0fSApO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gZ2V0UmVzKCkge1xyXG5cdFx0cmV0dXJuIHNlYXJjaFJlc3VsdDtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIGNsZWFyU2VhcmNoKCkge1xyXG5cdFx0Ly8gZW1pdCBldmVudCBjbGVhclNlYWNoXHJcblx0XHRzZWFyY2hSZXN1bHQubGVuZ3RoID0gMDtcclxuXHRcdHByZXZSZXN1bHRMZW4gPSAwO1xyXG5cdFx0dG90YWxQYWdlcyA9IC0xO1xyXG5cdFx0Y3VyclBhZ2UgPSAxO1xyXG5cdH1cclxuXHJcblx0cmV0dXJuIHtcclxuXHRcdHNlYXJjaEJ5VGl0bGUsXHJcblx0XHRzZWFyY2hCeUlkLFxyXG5cdFx0Y2xlYXJTZWFyY2gsXHJcblx0XHRnZXRSZXMsXHJcblx0XHRwcmV2UmVzdWx0TGVuLFxyXG5cdFx0cHV0SXRlbVRvREJcclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdFTkRQT0lOVF9VUkknLCAnJGh0dHAnLCAnJHEnLCAnYXV0aFRva2VuJyxcbmZ1bmN0aW9uICggbG9nLCBFTkRQT0lOVF9VUkksICRodHRwLCAkcSwgYXV0aFRva2VuICkge1xuXG5cdFx0dmFyIGlkZW50aXR5ID0gbnVsbDtcblx0XHR2YXIgX2lkZW50aXR5UmVzb2x2ZWQgPSBmYWxzZTtcblxuXHRcdGZ1bmN0aW9uIGF1dGhvcml6ZSggZm9yY2UgKSB7XG5cblx0XHRcdHZhciBkZWZlcnJlZCA9ICRxLmRlZmVyKCk7XG5cblx0XHRcdGlmICggZm9yY2UgKSBpZGVudGl0eSA9IG51bGw7XG5cblx0XHRcdGlmICggaWRlbnRpdHkgIT09IG51bGwgKSB7XG5cblx0XHRcdFx0ZGVmZXJyZWQucmVzb2x2ZSggdHJ1ZSApO1xuXG5cdFx0XHR9IGVsc2Uge1xuXG5cdFx0XHRcdCRodHRwLmdldCggRU5EUE9JTlRfVVJJICsgJ2F1dGgnLCB7IHJlcXVpcmVBdXRoOiB0cnVlIH0gKVxuXHRcdFx0XHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcblxuXHRcdFx0XHRcdFx0bG9nLmRlYnVnKCAnaW5mbycsICdhdXRoLmF1dGhvcml6ZSgpOicsIHJlcywgcmVzLmRhdGEgKTtcblx0XHRcdFx0XHRcdGlkZW50aXR5ID0gcmVzLmRhdGE7XG5cdFx0XHRcdFx0XHRfaWRlbnRpdHlSZXNvbHZlZCA9IHRydWU7XG5cdFx0XHRcdFx0XHRkZWZlcnJlZC5yZXNvbHZlKCB0cnVlICk7XG5cblx0XHRcdFx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcblxuXHRcdFx0XHRcdFx0bG9nLmRlYnVnKCAnd2FybicsICdhdXRob3JpemUnLCBlcnIsIGVyci5kYXRhICk7XG5cdFx0XHRcdFx0XHQvLyB0b2RvIGlmIGp3dCBleHBpcmVkICwgZGVhdXRob3JpemUsIHJlbW92ZSBsb2NhbCBzdG9yYWdlLCByZWRpcmVjdFxuXHRcdFx0XHRcdFx0X2lkZW50aXR5UmVzb2x2ZWQgPSB0cnVlO1xuXHRcdFx0XHRcdFx0ZGVmZXJyZWQucmVqZWN0KCBlcnIgKTtcblxuXHRcdFx0XHRcdH0gKTtcblxuXHRcdFx0fVxuXG5cdFx0XHRyZXR1cm4gZGVmZXJyZWQucHJvbWlzZTtcblxuXHRcdH1cblxuXHRcdGZ1bmN0aW9uIGRlYXV0aG9yaXplKCkge1xuXHRcdFx0YXV0aFRva2VuLnJlbW92ZVRva2VuKCk7XG5cdFx0XHRpZGVudGl0eSA9IG51bGw7XG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gaXNBdXRoZW50aWNhdGVkKCkge1xuXHRcdFx0cmV0dXJuIGlkZW50aXR5ICE9PSBudWxsO1xuXHRcdH1cblxuXHRcdGZ1bmN0aW9uIGlkZW50aXR5UmVzb2x2ZWQoKSB7XG5cdFx0XHRyZXR1cm4gX2lkZW50aXR5UmVzb2x2ZWQ7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHtcblxuXHRcdFx0YXV0aG9yaXplLFxuXHRcdFx0ZGVhdXRob3JpemUsXG5cdFx0XHRpc0F1dGhlbnRpY2F0ZWQsXG5cdFx0XHRpZGVudGl0eVJlc29sdmVkXG5cblx0XHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2F1dGhUb2tlbicsIGZ1bmN0aW9uICggYXV0aFRva2VuICkge1xuXG5cdGZ1bmN0aW9uIHJlcXVlc3QoIGNvbmZpZyApIHtcblxuXHRcdGlmICggY29uZmlnLnJlcXVpcmVBdXRoICkge1xuXHRcdFx0dmFyIHRva2VuID0gYXV0aFRva2VuLmdldFRva2VuKCk7XG5cdFx0XHRpZiAoIHRva2VuICkge1xuXHRcdFx0XHQvLyBodHRwOi8vc2VsZi1pc3N1ZWQuaW5mby9kb2NzL2RyYWZ0LWlldGYtb2F1dGgtdjItYmVhcmVyLmh0bWwgICBzZWN0aW9uIDIuMVxuXHRcdFx0XHQvLyBodHRwczovL2RldmVsb3BlcnMuZ29vZ2xlLmNvbS9nbWFpbC9tYXJrdXAvYWN0aW9ucy92ZXJpZnlpbmctYmVhcmVyLXRva2Vuc1xuXHRcdFx0XHQvLyBodHRwOi8vd3d3LnczLm9yZy9Qcm90b2NvbHMvcmZjMjYxNi9yZmMyNjE2LXNlYzQuaHRtbCBzZWN0aW9uIDQuMiBoZWFkZXIgZmllbGQgbmFtZSBjYXNlIGluc2Vuc2l0aXZlXG5cdFx0XHRcdGNvbmZpZy5oZWFkZXJzLkF1dGhvcml6YXRpb24gPSAnQmVhcmVyICcgKyB0b2tlbjtcblx0XHRcdH1cblx0XHR9XG5cblx0XHRyZXR1cm4gY29uZmlnO1xuXG5cdH1cblxuXHRmdW5jdGlvbiByZXNwb25zZSggcmVzICkge1xuXHRcdHJldHVybiByZXM7XG5cdH1cblxuXHRyZXR1cm4ge1xuXG5cdFx0cmVxdWVzdCxcblx0XHRyZXNwb25zZVxuXG5cdH07XG5cbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHdpbmRvdycsIGZ1bmN0aW9uICggbG9nLCAkd2luZG93ICkge1xuXG5cdHZhciBzdG9yYWdlID0gJHdpbmRvdy5sb2NhbFN0b3JhZ2U7XG5cdHZhciBjYWNoZWRUb2tlbiA9IG51bGw7XG5cblx0ZnVuY3Rpb24gc2V0VG9rZW4oIHRva2VuICkge1xuXHRcdGNhY2hlZFRva2VuID0gdG9rZW47XG5cdFx0c3RvcmFnZS5zZXRJdGVtKCAnand0JywgdG9rZW4gKTtcblx0fVxuXG5cdGZ1bmN0aW9uIGdldFRva2VuKCkge1xuXHRcdGlmICggIWNhY2hlZFRva2VuICkge1xuXHRcdFx0Y2FjaGVkVG9rZW4gPSBzdG9yYWdlLmdldEl0ZW0oICdqd3QnICk7XG5cdFx0fVxuXHRcdHJldHVybiBjYWNoZWRUb2tlbjtcblx0fVxuXG5cdGZ1bmN0aW9uIHJlbW92ZVRva2VuKCkge1xuXHRcdGNhY2hlZFRva2VuID0gbnVsbDtcblx0XHRzdG9yYWdlLnJlbW92ZUl0ZW0oICdqd3QnICk7XG5cdFx0bG9nLmRlYnVnKCAnaW5mbycsICd0b2tlbiByZW1vdmVkJyApO1xuXHR9XG5cblx0ZnVuY3Rpb24gaGFzVG9rZW4oKSB7XG5cdFx0cmV0dXJuICEhZ2V0VG9rZW4oKTtcblx0fVxuXG5cdHJldHVybiB7XG5cblx0XHRzZXRUb2tlbixcblx0XHRnZXRUb2tlbixcblx0XHRyZW1vdmVUb2tlbixcblx0XHRoYXNUb2tlblxuXG5cdH07XG5cbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckc2NvcGUnLCAnYXV0aCcsICdtb3ZpZUNvbGxlY3Rpb24nLCBmdW5jdGlvbiAoICRzY29wZSwgYXV0aCwgbW92aWVDb2xsZWN0aW9uICkgIHtcclxuXHJcblx0d2luZG93Lm1vdmllQ29sbGVjdGlvbiA9IG1vdmllQ29sbGVjdGlvbjtcclxuXHRjb25zb2xlLmxvZyggbW92aWVDb2xsZWN0aW9uLmdldENvbGxlY3Rpb24oKSApO1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckc2NvcGUnLCAnJGh0dHAnLCAnRU5EUE9JTlRfVVJJJywgJ2F1dGhUb2tlbicsICckc3RhdGUnLFxyXG5mdW5jdGlvbiAoIGxvZywgJHNjb3BlLCAkaHR0cCwgRU5EUE9JTlRfVVJJLCBhdXRoVG9rZW4sICRzdGF0ZSApICB7XHJcblxyXG5cdHZhciB2bSA9IHRoaXM7XHJcblx0dm0udXNlciA9IHtcclxuXHRcdGVtYWlsOiAnJyxcclxuXHRcdHBhc3N3b3JkOiAnJ1xyXG5cdH07XHJcblxyXG5cdHZtLnNpZ25pbiA9IGZ1bmN0aW9uKCkge1xyXG5cclxuXHRcdGlmICggdm0udXNlci5lbWFpbCA9PT0gJycgfHwgdm0udXNlci5wYXNzd29yZCA9PT0gJycgKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ3dhcm4nLCAnZW1haWwgJiBwYXNzd29yZCByZXF1aXJlZC4nICk7XHJcblx0XHRcdHJldHVybjtcclxuXHRcdH1cclxuXHJcblx0XHQkaHR0cC5wb3N0KCBFTkRQT0lOVF9VUkkgKyAnc2lnbmluJywgdm0udXNlciApXHJcblx0XHRcdC50aGVuKCBmdW5jdGlvbiggcmVzICkge1xyXG5cdFx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnc2lnbmluJywgcmVzLCByZXMuZGF0YSApO1xyXG5cdFx0XHRcdGF1dGhUb2tlbi5zZXRUb2tlbiggcmVzLmRhdGEudG9rZW4gKTtcclxuXHRcdFx0XHQkc3RhdGUuZ28oICdjb2xsZWN0aW9uJyApO1xyXG5cdFx0XHR9LCBmdW5jdGlvbiggZXJyLCBzdGF0dXMgKSB7XHJcblx0XHRcdFx0bG9nLmRlYnVnKCAnd2FybicsICdzaWduaW4nLCBlcnIgKTtcclxuXHRcdFx0fSApO1xyXG5cclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyRzdGF0ZScsICdhdXRoJywgJ21vdmllQ29sbGVjdGlvbicsIGZ1bmN0aW9uICggJHN0YXRlLCBhdXRoLCBtb3ZpZUNvbGxlY3Rpb24gKSAge1xyXG5cclxuXHRhdXRoLmRlYXV0aG9yaXplKCk7XHJcblx0bW92aWVDb2xsZWN0aW9uLl9jbGVhcigpO1xyXG5cdCRzdGF0ZS5nbyggJ3NpZ25pbicgKTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJyRodHRwJywgJ0VORFBPSU5UX1VSSScsICdhdXRoVG9rZW4nLCAnJHN0YXRlJyxcbmZ1bmN0aW9uICggbG9nLCAkc2NvcGUsICRodHRwLCBFTkRQT0lOVF9VUkksIGF1dGhUb2tlbiwgJHN0YXRlICkge1xuXG5cdFx0dmFyIHZtID0gdGhpcztcblx0XHR2bS51c2VyID0ge307XG5cblx0XHR2bS5zaWdudXAgPSBmdW5jdGlvbiAoKSB7XHJcblxuXHRcdFx0aWYgKCB2bS51c2VyLmVtYWlsID09PSB1bmRlZmluZWQgfHwgdm0udXNlci5wYXNzd29yZCA9PT0gdW5kZWZpbmVkICkge1xuXHRcdFx0XHRsb2cuZGVidWcoICd3YXJuJywgJ2VtYWlsICYgcGFzc3dvcmQgcmVxdWlyZWQuJyApO1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cblx0XHRcdGxvZy5kZWJ1ZyggJ3dhcm4nLCAnc2lnbmluZyB1cC4uLicgKTtcclxuXHRcdFx0JGh0dHAucG9zdCggRU5EUE9JTlRfVVJJICsgJ3NpZ251cCcsIHZtLnVzZXIgKVxyXG5cdFx0XHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcclxuXG5cdFx0XHRcdFx0bG9nLmRlYnVnKCAnaW5mbycsICdSZWdpc3RlcmVkLicgKTtcclxuXHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCByZXMgKTtcclxuXHJcblx0XHRcdFx0XHRhdXRoVG9rZW4uc2V0VG9rZW4oIHJlcy5kYXRhLnRva2VuICk7XHJcblx0XHRcdFx0XHQkc3RhdGUuZ28oICdjb2xsZWN0aW9uJyApO1xyXG5cblx0XHRcdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XHJcblxuXHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ3dhcm4nLCBlcnIgKTtcblx0XHRcdFx0XHR2bS5mb3JtLiRzdWJtaXR0ZWQgPSBmYWxzZTtcclxuXG5cdFx0XHRcdH0gKTtcclxuXG5cdFx0fTtcblxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgZnVuY3Rpb24gKCkge1xuXG5cdHZhciBkZWJ1Z0VuYWJsZWQgPSBmYWxzZTtcblx0dmFyIGRlYnVnTmFtZXNwYWNlcyA9IFtdO1xuXG5cdHRoaXMuZW5hYmxlRGVidWcgPSBmdW5jdGlvbiAoKSB7XG5cdFx0ZGVidWdFbmFibGVkID0gdHJ1ZTtcblx0fTtcblxuXHR0aGlzLmVuYWJsZURlYnVnTmFtZXNwYWNlID0gZnVuY3Rpb24gKCkge1xuXHRcdGZvciAoIGxldCBpID0gMDsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7IGkrKyApIHtcblx0XHRcdGRlYnVnTmFtZXNwYWNlcy5wdXNoKCBhcmd1bWVudHNbIGkgXSApO1xuXHRcdH1cblx0fTtcblxuXHR0aGlzLiRnZXQgPSAoKSA9PiB7XG5cblx0XHRmdW5jdGlvbiBkZWJ1ZygpIHtcblx0XHRcdGlmICggIWRlYnVnRW5hYmxlZCApIHJldHVybjtcclxuXHRcdFx0dmFyIGRlYnVnTmFtZSA9IGFyZ3VtZW50c1sgMCBdO1xyXG5cdFx0XHR2YXIgc2xpY2VkQXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKCBhcmd1bWVudHMsIDEgKTtcclxuXHRcdFx0aWYgKCBkZWJ1Z05hbWUgPT09ICdlcnInICkge1xyXG5cdFx0XHRcdGNvbnNvbGUuZXJyb3IuYXBwbHkoIGNvbnNvbGUsIHNsaWNlZEFyZ3MgKTtcclxuXHRcdFx0fSBlbHNlIGlmICggZGVidWdOYW1lID09PSAnaW5mbycgKSB7XHJcblx0XHRcdFx0Y29uc29sZS5pbmZvLmFwcGx5KCBjb25zb2xlLCBzbGljZWRBcmdzICk7XHJcblx0XHRcdH0gZWxzZSBpZiAoIGRlYnVnTmFtZSA9PT0gJ3dhcm4nICkge1xyXG5cdFx0XHRcdGNvbnNvbGUud2Fybi5hcHBseSggY29uc29sZSwgc2xpY2VkQXJncyApO1xyXG5cdFx0XHR9IGVsc2UgaWYgKCBkZWJ1Z05hbWVzcGFjZXMuaW5kZXhPZiggZGVidWdOYW1lICkgIT09IC0xICkge1xyXG5cdFx0XHRcdGNvbnNvbGUubG9nLmFwcGx5KCBjb25zb2xlLCBzbGljZWRBcmdzICk7XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHtcblx0XHRcdGRlYnVnXG5cdFx0fTtcblxuXHR9O1xuXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJHJvb3RTY29wZScsIGZ1bmN0aW9uICggJHJvb3RTY29wZSApIHtcclxuXHJcblx0dmFyIEVWVCA9IHtcclxuXHJcblx0XHRFT1A6IHtcclxuXHRcdFx0bGlzdGVuOiBmdW5jdGlvbiAoIGNiICkgeyAkcm9vdFNjb3BlLiRvbiggJ0VPUCcsIGNiICk7IH0sXHJcblx0XHRcdGVtaXQ6IGZ1bmN0aW9uICgpIHsgJHJvb3RTY29wZS4kYnJvYWRjYXN0KCAnRU9QJyApOyB9XHJcblx0XHR9LFxyXG5cclxuXHR9O1xyXG5cclxuXHRyZXR1cm4gRVZUO1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyR3aW5kb3cnLCAnRU5HSU5FJywgJ3V0aWwnLCBmdW5jdGlvbiAoICR3aW5kb3csIEVOR0lORSwgdXRpbCApIHtcblxuXHRmdW5jdGlvbiBjdHJsKCAkc2NvcGUsICRlbGVtZW50ICkge1xuXG5cdFx0RU5HSU5FLmF0dGFjaFJlbmRlcmVyKCAkZWxlbWVudCApO1xyXG5cdFx0JCggJHdpbmRvdyApLm9uKCAncmVzaXplJywgdXRpbC5kZWJvdW5jZSggRU5HSU5FLm9uV2luZG93UmVzaXplLCAxMDAgKSApXHJcblx0XHQkZWxlbWVudC5vbiggJ3doZWVsJywgZnVuY3Rpb24gKCBldnQgKSB7XG5cdFx0XHRFTkdJTkUuJCQud2hlZWxfZHkgPSAtTWF0aC5zaWduKCBldnQub3JpZ2luYWxFdmVudC5kZWx0YVkgKTtcblx0XHR9ICk7XG5cclxuXHRcdEVOR0lORS5zdGFydCgpO1xuXG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdHJlc3RyaWN0OiAnRScsXG5cdFx0cmVwbGFjZTogdHJ1ZSxcblx0XHRjb250cm9sbGVyOiBjdHJsLFxuXHRcdHRlbXBsYXRlOiAnPGRpdiBpZD1cImNhbnZhcy1jb250YWluZXJcIj48L2Rpdj4nXG5cdH07XG5cbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckd2luZG93JywgZnVuY3Rpb24gKCAkd2luZG93ICkge1xuXG5cdHZhciAkJCA9IHtcblx0XHRjYW52YXM6IG51bGwsXG5cdFx0c3RhdHM6IG5ldyBTdGF0cygpLFxuXHRcdHNjZW5lOiBuZXcgVEhSRUUuU2NlbmUoKSxcblx0XHR3aWR0aDogJHdpbmRvdy5pbm5lcldpZHRoLFxuXHRcdGhlaWdodDogJHdpbmRvdy5pbm5lckhlaWdodCxcblx0XHRjYW1lcmE6IG5ldyBUSFJFRS5QZXJzcGVjdGl2ZUNhbWVyYSggNzAsIHRoaXMud2lkdGggLyB0aGlzLmhlaWdodCwgMTAsIDEwMDAwMCApLFxuXHRcdHJlbmRlcmVyOiBuZXcgVEhSRUUuQ1NTM0RSZW5kZXJlcigpLFxuXHRcdHNjcmVlbl9yYXRpbzogdGhpcy53aWR0aCAvIHRoaXMuaGVpZ2h0LFxuXHRcdHBpeGVsX3JhdGlvOiAkd2luZG93LmRldmljZVBpeGVsUmF0aW8gfHwgMSxcblx0XHRtb3VzZV94OiB0aGlzLndpZHRoICogMC41LFxuXHRcdG1vdXNlX3k6IHRoaXMuaGVpZ2h0ICogMC41LFxuXHRcdHdoZWVsX2R5OiAwXG5cdH07XG5cblx0JCQucmVuZGVyZXIuc2V0U2l6ZSggJCQud2lkdGgsICQkLmhlaWdodCApO1xuXG5cdGZ1bmN0aW9uIGF0dGFjaFJlbmRlcmVyKCBjYW52YXMgKSB7XG5cdFx0JCQuY2FudmFzID0gY2FudmFzO1xuXHRcdGNhbnZhcy5hcHBlbmQoICQkLnJlbmRlcmVyLmRvbUVsZW1lbnQgKTtcblx0XHRjYW52YXMuYXBwZW5kKCAkJC5zdGF0cy5kb21FbGVtZW50ICk7XG5cdH1cblxuXHRmdW5jdGlvbiBvbldpbmRvd1Jlc2l6ZSgpIHtcblx0XHQkJC53aWR0aCA9ICR3aW5kb3cuaW5uZXJXaWR0aDtcblx0XHQkJC5oZWlnaHQgPSAkd2luZG93LmlubmVySGVpZ2h0O1xuXHRcdCQkLnBpeGVsX3JhdGlvID0gJHdpbmRvdy5kZXZpY2VQaXhlbFJhdGlvIHx8IDE7XG5cdFx0JCQuc2NyZWVuX3JhdGlvID0gJCQud2lkdGggLyAkJC5oZWlnaHQ7XG5cdFx0JCQuY2FtZXJhLmFzcGVjdCA9ICQkLnNjcmVlbl9yYXRpbztcblx0XHQkJC5jYW1lcmEudXBkYXRlUHJvamVjdGlvbk1hdHJpeCgpO1xuXHRcdCQkLnJlbmRlcmVyLnNldFNpemUoICQkLndpZHRoLCAkJC5oZWlnaHQgKTtcblx0fVxuXG5cdGZ1bmN0aW9uIHNldHVwKCkge1xuXG5cdH1cblxuXHRmdW5jdGlvbiB1cGRhdGUoKSB7XG5cblx0XHRpZiAoIE1hdGguYWJzKCAkJC53aGVlbF9keSApID4gMC4wMDEgKSB7XG5cdFx0XHQkJC5jYW1lcmEucG9zaXRpb24ueSArPSAkJC53aGVlbF9keSAqIDEuMDtcblx0XHRcdCQkLmNhbWVyYS5yb3RhdGVZKCAkJC53aGVlbF9keSAqIDAuMDI1ICk7XG5cdFx0XHQkJC53aGVlbF9keSAqPSAwLjk1O1xuXHRcdH1cblxuXHR9XG5cblx0Ly8gLS0tLSAgZHJhdyBsb29wXG5cdGZ1bmN0aW9uIHJ1bigpIHtcblxuXHRcdHJlcXVlc3RBbmltYXRpb25GcmFtZSggcnVuICk7XG5cdFx0dXBkYXRlKCk7XG5cdFx0JCQucmVuZGVyZXIucmVuZGVyKCAkJC5zY2VuZSwgJCQuY2FtZXJhICk7XG5cdFx0JCQuc3RhdHMudXBkYXRlKCk7XG5cblx0fVxuXG5cdGZ1bmN0aW9uIHN0YXJ0KCkge1xuXHRcdHNldHVwKCk7XG5cdFx0cnVuKCk7XG5cdH1cblxuXHRmdW5jdGlvbiByZXNldENhbWVyYSgpIHtcblx0XHQkJC5jYW1lcmEucG9zaXRpb24uc2V0KCAwLCAwLCAwICk7XG5cdFx0JCQuY2FtZXJhLnJvdGF0aW9uLnNldCggMCwgMCwgMCApO1xuXHR9XG5cblx0cmV0dXJuIHtcblx0XHQkJCxcblx0XHRhdHRhY2hSZW5kZXJlcixcblx0XHRvbldpbmRvd1Jlc2l6ZSxcblx0XHRzdGFydCxcblx0XHRyZXNldENhbWVyYSxcblx0fTtcblxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdFTkdJTkUnLCAnJGNvbXBpbGUnLCAnJHJvb3RTY29wZScsXHJcbmZ1bmN0aW9uICggbG9nLCBFTkdJTkUsICRjb21waWxlLCAkcm9vdFNjb3BlICkge1xyXG5cblx0dmFyIGFsbFBvc3RlcnMgPSBuZXcgVEhSRUUuT2JqZWN0M0QoKTtcblx0RU5HSU5FLiQkLnNjZW5lLmFkZCggYWxsUG9zdGVycyApO1xuXG5cdGZ1bmN0aW9uIG1ha2VIZWxpeFBvc3RlcnMoIHBvc3Rlck9iamVjdE11bHRpLCBvZmZzZXRTdGFydElkeCApIHtcblxyXG5cdFx0dmFyIHZlY3RvciA9IG5ldyBUSFJFRS5WZWN0b3IzKCk7XHJcblx0XHR2YXIgcmFkaXVzID0gOTAwO1xyXG5cdFx0Zm9yICggdmFyIGkgPSAwOyBpIDwgcG9zdGVyT2JqZWN0TXVsdGkubGVuZ3RoOyBpKysgKSB7XG5cblx0XHRcdHZhciAkaXNvbGF0ZWRTY29wZSA9ICRyb290U2NvcGUuJG5ldyggdHJ1ZSApO1xuXHRcdFx0JGlzb2xhdGVkU2NvcGUubW92aWVJdGVtID0gcG9zdGVyT2JqZWN0TXVsdGlbIGkgXTtcclxuXHJcblx0XHRcdHZhciBwb3N0ZXJEaXJlY3RpdmVFbGVtID0gJGNvbXBpbGUoICc8cG9zdGVyPjwvcG9zdGVyPicgKSggJGlzb2xhdGVkU2NvcGUgKVsgMCBdO1xuXHRcdFx0dmFyIGNzczNkT2JqID0gbmV3IFRIUkVFLkNTUzNET2JqZWN0KCBwb3N0ZXJEaXJlY3RpdmVFbGVtICk7XHJcblxyXG5cdFx0XHQvLyB0YWcgYWxvZyBhbiBpc29sYXRlZFNjb3BlIHRvIGJlIGRlc3Ryb3kgd2hlbiBkaXNwb3NlIGFuIGVsZW1lbnRcclxuXHRcdFx0Y3NzM2RPYmouc2NvcGUgPSAkaXNvbGF0ZWRTY29wZTtcclxuXHJcblx0XHRcdHZhciBoaWR4ID0gaSArIG9mZnNldFN0YXJ0SWR4O1xuXHRcdFx0dmFyIHBoaSA9IGhpZHggKiAwLjE3NSArIE1hdGguUEk7XHJcblx0XHRcdGNzczNkT2JqLnBvc2l0aW9uLnggPSAtIHJhZGl1cyAqIE1hdGguc2luKCBwaGkgKTtcclxuXHRcdFx0Y3NzM2RPYmoucG9zaXRpb24ueSA9IC0gKCBoaWR4ICogOCApICsgMjAwO1xyXG5cdFx0XHRjc3MzZE9iai5wb3NpdGlvbi56ID0gcmFkaXVzICogTWF0aC5jb3MoIHBoaSApO1xyXG5cclxuXHRcdFx0dmVjdG9yLnNldCggLWNzczNkT2JqLnBvc2l0aW9uLnggKiAyLCBjc3MzZE9iai5wb3NpdGlvbi55LCAtY3NzM2RPYmoucG9zaXRpb24ueiAqIDIgKTtcclxuXG5cdFx0XHRjc3MzZE9iai5sb29rQXQoIHZlY3RvciApO1xyXG5cdFx0XHRhbGxQb3N0ZXJzLmFkZCggY3NzM2RPYmogKTtcblxuXHRcdH1cblxuXHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnY3VyciBwb3N0ZXJzOicsIGFsbFBvc3RlcnMuY2hpbGRyZW4ubGVuZ3RoICk7XHJcblxyXG5cdH1cblxuXHRmdW5jdGlvbiBjbGVhckFsbCgpIHtcclxuXHRcdGFsbFBvc3RlcnMuY2hpbGRyZW4uZm9yRWFjaCggZnVuY3Rpb24gKCBwb3N0ZXIgKSB7XHJcblx0XHRcdHBvc3Rlci5kaXNwb3NlRWxlbWVudCgpO1xyXG5cdFx0XHRwb3N0ZXIuc2NvcGUuJGRlc3Ryb3koKTtcclxuXHRcdH0gKTtcclxuXHRcdGFsbFBvc3RlcnMuY2hpbGRyZW4ubGVuZ3RoID0gMDsgLy8gY2xlYXIgaXRlbXNcclxuXHR9XHJcblxuXHRyZXR1cm4ge1xuXHRcdG1ha2VIZWxpeFBvc3RlcnMsXG5cdFx0Y2xlYXJBbGxcblx0fTtcblxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyRzdGF0ZScsIGZ1bmN0aW9uICggJHN0YXRlICkge1xyXG5cblx0ZnVuY3Rpb24gY3RybCggJHNjb3BlLCAkZWxlbWVudCApIHtcblxyXG5cdFx0Ly8gJHNjb3BlLm1vdmllSXRlbSBvYmogaXMgcGFzc2VkIHRocnUgaXNvbGF0ZWRTY29wZSB2aWEgY29tcGlsZWQgZGlyZWN0aXZlIGluIGhlbGl4LmZhYy5qc1xyXG5cclxuXHRcdHZhciBpbWcgPSBuZXcgSW1hZ2UoKTtcclxuXHRcdHZhciBpbWdVcmwgPSAnaHR0cDovL2ltYWdlLnRtZGIub3JnL3QvcC93MTU0LycgKyAkc2NvcGUubW92aWVJdGVtLnBvc3Rlcl9wYXRoO1xyXG5cdFx0aW1nLm9ubG9hZCA9IGZ1bmN0aW9uICgpIHtcclxuXHJcblx0XHRcdC8vIHRvZG8gbW92ZSBjc3MgaW50byBzYXNzLCB1c2UgY2xhc3MgaW5zdGVhZFxyXG5cdFx0XHQkZWxlbWVudC5jc3MoIHtcclxuXHRcdFx0XHQnd2lkdGgnOiAnMTUwcHgnLFxyXG5cdFx0XHRcdCdoZWlnaHQnOiAnMjMwcHgnLFxyXG5cdFx0XHRcdCdiYWNrZ3JvdW5kLXJlcGVhdCc6ICduby1yZXBlYXQnLFxyXG5cdFx0XHRcdCdiYWNrZ3JvdW5kLXNpemUnOiAnMTUwcHggMjMwcHgnLFxyXG5cdFx0XHRcdCdiYWNrZ3JvdW5kLWltYWdlJzogJ3VybCgnICsgaW1nVXJsICsgJyknLFxyXG5cdFx0XHRcdCdkaXNwbGF5JzogJ25vbmUnIC8vIHJlcXVpcmVkIGZvciBmYWRlSW4gYW5pbWF0aW9uXHJcblx0XHRcdH0gKTtcclxuXHRcdFx0JGVsZW1lbnQuZmFkZUluKCAxNTAwICk7XHJcblxyXG5cdFx0fTtcclxuXHRcdGltZy5zcmMgPSBpbWdVcmw7XHJcblxuXHRcdCRlbGVtZW50Lm9uKCAnY2xpY2snLCBmdW5jdGlvbiAoIGV2dCApIHtcclxuXHRcdFx0JHN0YXRlLmdvKCAnbW92aWVEZXRhaWwnLCB7IG1vdmllSWQ6ICRzY29wZS5tb3ZpZUl0ZW0uaWQgfSApO1xyXG5cdFx0fSApO1xuXG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdHJlc3RyaWN0OiAnRScsXG5cdFx0cmVwbGFjZTogdHJ1ZSxcblx0XHRjb250cm9sbGVyOiBjdHJsLFxuXHRcdHRlbXBsYXRlOiAnPGRpdiBjbGFzcz1cInBvc3RlckVsZW1cIj48L2Rpdj4nXG5cdH07XG5cbn0gXTtcclxuIiwiYW5ndWxhci5tb2R1bGUoICdhcHAnLCBbXG5cdCd1aS5yb3V0ZXInLFxuXHQnbmdBbmltYXRlJ1xuXSApXG4uY29uc3RhbnQoICdFTkRQT0lOVF9VUkknLCAnaHR0cDovL2xvY2FsaG9zdDo4MDAxLycgKVxuLmNvbnN0YW50KCAnVE1EQl9BUEknLCB7XG5cdGtleTogJzM3NGMwMzQyYTY0MDZkZmUwYWViM2RlMmVhMDQyYzU5Jyxcblx0dXJsOiAnaHR0cDovL2FwaS50aGVtb3ZpZWRiLm9yZy8zLydcbn0gKVxuXG4ucHJvdmlkZXIoICdsb2cnLCByZXF1aXJlKCAnLi9kZWJ1Zy9sb2cucHYuanMnICkgKVxuXG4uZmFjdG9yeSggJ3V0aWwnLCByZXF1aXJlKCAnLi91dGlsLmpzJyApIClcbi5jb250cm9sbGVyKCAnbWFpbkN0cmwnLCByZXF1aXJlKCAnLi9tYWluLmN0cmwuanMnICkgKVxuLmZhY3RvcnkoICdUTURiJywgcmVxdWlyZSggJy4vVE1EYi5mYWMuanMnICkgKVxuLmZhY3RvcnkoICdFVlQnLCByZXF1aXJlKCAnLi9ldmVudHMuZmFjLmpzJyApIClcbi5jb250cm9sbGVyKCAnbW92aWVEZXRhaWxDdHJsJywgcmVxdWlyZSggJy4vbW92aWVEZXRhaWwuY3RybC5qcycgKSApXG4uZGlyZWN0aXZlKCAnZGlzcGxheScsIHJlcXVpcmUoICcuL2hlbGl4L2Rpc3BsYXkuZGlyLmpzJyApIClcbi5mYWN0b3J5KCAnRU5HSU5FJywgcmVxdWlyZSggJy4vaGVsaXgvZW5naW5lLmZhYy5qcycgKSApXG4uZmFjdG9yeSggJ2hlbGl4JywgcmVxdWlyZSggJy4vaGVsaXgvaGVsaXguZmFjLmpzJyApIClcbi5kaXJlY3RpdmUoICdwb3N0ZXInLCByZXF1aXJlKCAnLi9oZWxpeC9wb3N0ZXIuZGlyLmpzJyApIClcblxuLmNvbnRyb2xsZXIoICdzaWdudXBDdHJsJywgcmVxdWlyZSggJy4vYXV0aC9zaWdudXAuY3RybC5qcycgKSApXG4uY29udHJvbGxlciggJ3NpZ25pbkN0cmwnLCByZXF1aXJlKCAnLi9hdXRoL3NpZ25pbi5jdHJsLmpzJyApIClcbi5jb250cm9sbGVyKCAnc2lnbm91dEN0cmwnLCByZXF1aXJlKCAnLi9hdXRoL3NpZ25vdXQuY3RybC5qcycgKSApXG4uY29udHJvbGxlciggJ2NvbGxlY3Rpb25DdHJsJywgcmVxdWlyZSggJy4vYXV0aC9jb2xsZWN0aW9uLmN0cmwuanMnICkgKVxuXG4uZmFjdG9yeSggJ2F1dGgnLCByZXF1aXJlKCAnLi9hdXRoL2F1dGguZmFjLmpzJyApIClcbi5mYWN0b3J5KCAnYXV0aFRva2VuJywgcmVxdWlyZSggJy4vYXV0aC9hdXRoVG9rZW4uZmFjLmpzJyApIClcbi5mYWN0b3J5KCAnYXV0aEludGVyY2VwdG9yJywgcmVxdWlyZSggJy4vYXV0aC9hdXRoSW50ZXJjZXB0b3IuZmFjLmpzJyApIClcblxuLmZhY3RvcnkoICdtb3ZpZUNvbGxlY3Rpb24nLCByZXF1aXJlKCAnLi9tb3ZpZUNvbGxlY3Rpb24uZmFjLmpzJyApIClcblxuLmNvbmZpZyggWyAnJHN0YXRlUHJvdmlkZXInLCAnJHVybFJvdXRlclByb3ZpZGVyJywgJyRodHRwUHJvdmlkZXInLFxuZnVuY3Rpb24gKCAkc3RhdGVQcm92aWRlciwgJHVybFJvdXRlclByb3ZpZGVyLCAkaHR0cFByb3ZpZGVyICkge1xuXG5cdCR1cmxSb3V0ZXJQcm92aWRlci5vdGhlcndpc2UoICcvJyApO1xuXG5cdCRzdGF0ZVByb3ZpZGVyXG5cdFx0LnN0YXRlKCAnaG9tZScsIHtcblx0XHRcdHVybDogJy8nLFxuXHRcdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL2hvbWUuaHRtbCdcblx0XHR9IClcblx0XHQuc3RhdGUoICdtb3ZpZURldGFpbCcsIHtcblx0XHRcdHVybDogJy9tb3ZpZS86bW92aWVJZCcsXG5cdFx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvbW92aWUuaHRtbCcsXG5cdFx0XHRjb250cm9sbGVyOiAnbW92aWVEZXRhaWxDdHJsJyxcblx0XHRcdGNvbnRyb2xsZXJBczogJ21kJyxcblx0XHRcdHJlc29sdmU6IHtcblx0XHRcdFx0bW92aWVJdGVtOiBbICckc3RhdGVQYXJhbXMnLCAnVE1EYicsIGZ1bmN0aW9uICggJHN0YXRlUGFyYW1zLCBUTURiICkge1xuXHRcdFx0XHRcdHJldHVybiBUTURiLnNlYXJjaEJ5SWQoICRzdGF0ZVBhcmFtcy5tb3ZpZUlkICk7XG5cdFx0XHRcdH1dXG5cdFx0XHR9XG5cdFx0fSApXG5cdFx0LnN0YXRlKCAnc2lnbnVwJywge1xuXHRcdFx0dXJsOiAnL3NpZ251cCcsXG5cdFx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvc2lnbnVwLmh0bWwnLFxuXHRcdFx0Y29udHJvbGxlcjogJ3NpZ251cEN0cmwnLFxuXHRcdFx0Y29udHJvbGxlckFzOiAnc2lnbnVwJ1xuXHRcdH0gKVxuXHRcdC5zdGF0ZSggJ3NpZ25pbicsIHtcblx0XHRcdHVybDogJy9zaWduaW4nLFxuXHRcdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL3NpZ25pbi5odG1sJyxcblx0XHRcdGNvbnRyb2xsZXI6ICdzaWduaW5DdHJsJyxcblx0XHRcdGNvbnRyb2xsZXJBczogJ3NpZ25pbidcblx0XHR9IClcblx0XHQuc3RhdGUoICdzaWdub3V0Jywge1xuXHRcdFx0dXJsOiAnL3NpZ25vdXQnLFxuXHRcdFx0Y29udHJvbGxlcjogJ3NpZ25vdXRDdHJsJ1xuXHRcdH0gKVxuXHRcdC5zdGF0ZSgnY29sbGVjdGlvbicsIHtcblx0XHRcdHVybDogJy9jb2xsZWN0aW9uJyxcblx0XHRcdHRlbXBsYXRlVXJsOiAnLi90ZW1wbGF0ZS9jb2xsZWN0aW9uLmh0bWwnLFxuXHRcdFx0Y29udHJvbGxlcjogJ2NvbGxlY3Rpb25DdHJsJyxcblx0XHRcdGNvbnRyb2xsZXJBczogJ2NvbGwnLFxuXHRcdFx0cmVzb2x2ZToge1xuXHRcdFx0XHRhdXRob3JpemU6IFsgJ2F1dGgnLCBmdW5jdGlvbiAoIGF1dGggKSB7XG5cdFx0XHRcdFx0cmV0dXJuIGF1dGguYXV0aG9yaXplKCk7XG5cdFx0XHRcdH0gXSxcblx0XHRcdFx0cmVzb2x2ZWRDb2xsZWN0aW9uOiBbICdtb3ZpZUNvbGxlY3Rpb24nLCBmdW5jdGlvbiAoIG1vdmllQ29sbGVjdGlvbiApIHtcblx0XHRcdFx0XHRyZXR1cm4gbW92aWVDb2xsZWN0aW9uLnJlc29sdmVDb2xsZWN0aW9uKCk7XG5cdFx0XHRcdH0gXVxuXHRcdFx0fVxuXHRcdH0pXG5cdDtcblxuXHQkaHR0cFByb3ZpZGVyLmludGVyY2VwdG9ycy5wdXNoKCAnYXV0aEludGVyY2VwdG9yJyApO1xuXG59IF0gKVxuLnJ1biggWyAnbG9nJywgJyRyb290U2NvcGUnLCAnJHN0YXRlJywgJ2F1dGgnLCBmdW5jdGlvbiAoIGxvZywgJHJvb3RTY29wZSwgJHN0YXRlLCBhdXRoICkge1xuXG5cdC8vIHRvZG8gYXV0aG9yaXplIHVzZXIgZXZlcnkgYmVnaW5uaW5nIG9mIHNlc3Npb25cblx0Ly8gdG9kbyBkb250IGF1dG9yaXplIHR3aWNlXG5cdGF1dGguYXV0aG9yaXplKCB0cnVlICk7XG5cblx0JHJvb3RTY29wZS4kb24oICckc3RhdGVDaGFuZ2VFcnJvcicsIGZ1bmN0aW9uICggZXZlbnQsIHRvU3RhdGUsIHRvUGFyYW1zLCBmcm9tU3RhdGUsIGZyb21QYXJhbXMsIGVycm9yICkge1xuXG5cdFx0ZXZlbnQucHJldmVudERlZmF1bHQoKTsgLy8gcHJldmVudCB0cmFuc2l0aW9uXG5cdFx0bG9nLmRlYnVnKCAnd2FybicsIGVycm9yICk7XG5cdFx0aWYgKCBlcnJvciApIHtcblx0XHRcdCRzdGF0ZS5nbyggJ3NpZ25pbicgKTtcblx0XHR9XG5cblx0fSApO1xuXG59IF0gKVxuLmNvbmZpZyggWyAnbG9nUHJvdmlkZXInLCAnJGh0dHBQcm92aWRlcicsIGZ1bmN0aW9uICggbG9nUHJvdmlkZXIsICRodHRwUHJvdmlkZXIgKSB7XG5cblx0bG9nUHJvdmlkZXIuZW5hYmxlRGVidWcoKTtcblx0bG9nUHJvdmlkZXIuZW5hYmxlRGVidWdOYW1lc3BhY2UoICdpbmZvJywgJ2VycicsICdhdXRoJyApOyAvLyBjdHJsXG5cblx0JGh0dHBQcm92aWRlci51c2VMZWdhY3lQcm9taXNlRXh0ZW5zaW9ucyggZmFsc2UgKTtcblxufSBdIClcbjtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJyRzY29wZScsICdUTURiJywgJ0VWVCcsICdoZWxpeCcsICdFTkdJTkUnLCAnYXV0aCcsXG5mdW5jdGlvbiAoIGxvZywgJHNjb3BlLCBUTURiLCBFVlQsIGhlbGl4LCBFTkdJTkUsIGF1dGggKSB7XG5cblx0dmFyIHZtID0gdGhpcztcblx0dm0uYXV0aCA9IGF1dGg7XG5cdHZtLnNlYXJjaCA9IHtcblx0XHRxdWVyeTogJycsXG5cdH07XG5cdHZtLm1vdmllSXRlbXMgPSBudWxsO1xuXG5cdCRzY29wZS4kd2F0Y2goIFRNRGIuZ2V0UmVzLCBmdW5jdGlvbiAoIG1vdkl0ZW1zICkge1xuXG5cdFx0dm0ubW92aWVJdGVtcyA9IG1vdkl0ZW1zO1xuXHRcdGhlbGl4Lm1ha2VIZWxpeFBvc3RlcnMoIG1vdkl0ZW1zLnNsaWNlKCBUTURiLnByZXZSZXN1bHRMZW4gKSwgVE1EYi5wcmV2UmVzdWx0TGVuICk7XG5cblx0fSwgdHJ1ZSApO1xuXG5cdHZhciBwcmV2UXVlcnkgPSAnJztcblx0dm0uc2VhcmNoID0gZnVuY3Rpb24gKCkge1xuXHRcdGlmICggdm0uc2VhcmNoLnF1ZXJ5ID09PSAnJyApIHJldHVybjtcblx0XHRpZiAoIHByZXZRdWVyeSAhPT0gdm0uc2VhcmNoLnF1ZXJ5ICkge1xuXHRcdFx0cHJldlF1ZXJ5ID0gdm0uc2VhcmNoLnF1ZXJ5O1xuXHRcdFx0VE1EYi5jbGVhclNlYXJjaCgpO1xuXHRcdFx0aGVsaXguY2xlYXJBbGwoKTtcblx0XHRcdEVOR0lORS5yZXNldENhbWVyYSgpO1xuXHRcdH1cblx0XHRUTURiLnNlYXJjaEJ5VGl0bGUoIHZtLnNlYXJjaCApO1xuXHR9O1xuXG5cdC8vIERFQlVHXG5cdHdpbmRvdy5TQ09QRSA9ICRzY29wZTtcblx0dm0uVE1EYiA9IFRNRGI7XG5cdHZtLmhlbGl4ID0gaGVsaXg7XG5cdHZtLkVOR0lORSA9IEVOR0lORTtcblxuXHRFVlQuRU9QLmxpc3RlbiggZnVuY3Rpb24gKCkge1xuXHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAncmVjaWV2ZWQgRU9QIGV2ZW50IScgKTtcblx0fSApO1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdFTkRQT0lOVF9VUkknLCAnJGh0dHAnLCAnJHEnLCBmdW5jdGlvbiAoIGxvZywgRU5EUE9JTlRfVVJJLCAkaHR0cCwgJHEgKSB7XHJcblxyXG5cdHZhciBEQl9FTkRQT0lOVCA9IEVORFBPSU5UX1VSSSArICdjb2xsZWN0aW9uJztcclxuXHR2YXIgY29sbGVjdGlvbiA9IG51bGw7XHJcblxyXG5cdGZ1bmN0aW9uIGNyZWF0ZSggbmFtZSApIHtcclxuXHRcdC8vIGNvbGxlY3Rpb24gbmVlZHMgdG8gYmUgcmVzb2x2ZWQgZmlyc3RcclxuXHRcdC8vIHRvZG8gY2hlY2sgaWYgY29sbGVjdGlvbiBpcyBhbHJlZHkgZXhpc3RzXHJcblx0XHRjb2xsZWN0aW9uLnB1c2goIHsgY29sbGVjdGlvbk5hbWU6IG5hbWUsIG1vdmllczogW10gfSApO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gcmVzb2x2ZUNvbGxlY3Rpb24oKSB7XHJcblxyXG5cdFx0dmFyIGRlZmVycmVkID0gJHEuZGVmZXIoKTtcclxuXHJcblx0XHRpZiAoIGNvbGxlY3Rpb24gIT09IG51bGwgKSB7XHJcblx0XHRcdGRlZmVycmVkLnJlc29sdmUoIGNvbGxlY3Rpb24gKTtcclxuXHRcdH0gZWxzZSB7XHJcblx0XHRcdCRodHRwLmdldCggREJfRU5EUE9JTlQsIHsgcmVxdWlyZUF1dGg6IHRydWUgfSApXHJcblx0XHRcdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cdFx0XHRcdFx0bG9nLmRlYnVnKCAnaW5mbycsICdjb2xsZWN0aW9uLnJlc29sdmVDb2xsZWN0aW9uKCk6JywgcmVzICk7XHJcblx0XHRcdFx0XHRpZiAoIHJlcy5kYXRhICkge1xyXG5cdFx0XHRcdFx0XHRjb2xsZWN0aW9uID0gcmVzLmRhdGE7XHJcblx0XHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0XHRjb2xsZWN0aW9uID0gW107XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHRkZWZlcnJlZC5yZXNvbHZlKCB0cnVlICk7XHJcblx0XHRcdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XHJcblx0XHRcdFx0XHRsb2cuZGVidWcoICdlcnInLCAnY29sbGVjdGlvbi5yZXNvbHZlQ29sbGVjdGlvbigpOicsIGVyciApO1xyXG5cdFx0XHRcdFx0ZGVmZXJyZWQucmVqZWN0KCBlcnIgKTtcclxuXHRcdFx0XHR9ICk7XHJcblx0XHR9XHJcblxyXG5cdFx0cmV0dXJuIGRlZmVycmVkLnByb21pc2U7XHJcblxyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gZ2V0KCkge1xyXG5cdFx0Ly8gJGh0dHAuZ2V0KCBEQl9FTkRQT0lOVCwgeyByZXF1aXJlQXV0aDogdHJ1ZSB9IClcclxuXHRcdC8vIFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cdFx0Ly8gXHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnY29sbGVjdGlvbi5nZXQoKTonLCByZXMgKTtcclxuXHRcdC8vIFx0XHRpZiAoIHJlcy5kYXRhICkge1xyXG5cdFx0Ly8gXHRcdFx0Y29sbGVjdGlvbiA9IHJlcy5kYXRhO1xyXG5cdFx0Ly8gXHRcdH0gZWxzZSB7XHJcblx0XHQvLyBcdFx0XHRjb2xsZWN0aW9uID0gW107XHJcblx0XHQvLyBcdFx0fVxyXG5cdFx0Ly8gXHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdC8vIFx0XHRsb2cuZGVidWcoICdlcnInLCAnY29sbGVjdGlvbi5nZXQoKTonLCBlcnIgKTtcclxuXHRcdC8vIFx0fSApO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gcHV0KCkge1xyXG5cdFx0JGh0dHAucHV0KCBEQl9FTkRQT0lOVCwgY29sbGVjdGlvbiwgeyByZXF1aXJlQXV0aDogdHJ1ZSB9IClcclxuXHRcdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cdFx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnY29sbGVjdGlvbi5wdXQoKTonLCByZXMgKTtcclxuXHRcdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XHJcblx0XHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ2NvbGxlY3Rpb24ucHV0KCk6JywgZXJyICk7XHJcblx0XHRcdH0gKTtcclxuXHR9XHJcblxyXG5cdC8qIGNvbGxlY3Rpb25zIG5lZWRzIHRvIGJlIHJlc29sdmVkIGZpcnN0XHJcblx0dXBkYXRlIGxvY2FsIGNvbGxlY3Rpb25cclxuXHQqL1xyXG5cdGZ1bmN0aW9uIHB1c2goIGl0ZW1JZCwgdG9Db2xsZWN0aW9uICkge1xyXG5cdFx0Zm9yICggdmFyIGkgPSAwOyBpIDwgY29sbGVjdGlvbi5sZW5ndGg7IGkgKysgKSB7XHJcblx0XHRcdGlmICggY29sbGVjdGlvbltpXS5jb2xsZWN0aW9uTmFtZSA9PT0gdG9Db2xsZWN0aW9uICkge1xyXG5cdFx0XHRcdGNvbGxlY3Rpb25baV0ubW92aWVzLnB1c2goIGl0ZW1JZCApO1xyXG5cdFx0XHRcdHJldHVybiB0cnVlO1xyXG5cdFx0XHR9XHJcblx0XHR9XHJcblx0XHRyZXR1cm4gZmFsc2U7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiByZW1vdmUoIGl0ZW1JZCwgZnJvbUNvbGxlY3Rpb24gKSB7XHJcblx0XHRmb3IgKCB2YXIgaSA9IDA7IGkgPCBjb2xsZWN0aW9uLmxlbmd0aDsgaSArKyApIHtcclxuXHRcdFx0aWYgKCBjb2xsZWN0aW9uW2ldID09PSBmcm9tQ29sbGVjdGlvbiApIHtcclxuXHRcdFx0XHRjb2xsZWN0aW9uLnNwbGljZSggaSwgMSApO1xyXG5cdFx0XHRcdHJldHVybiB0cnVlO1xyXG5cdFx0XHR9XHJcblx0XHR9XHJcblx0XHRyZXR1cm4gZmFsc2U7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBzeW5jKCkge1xyXG5cdFx0Ly8gc3luYyBsb2NhbCBjb2xlbGN0aW9uIHcvIERCXHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBnZXRDb2xsZWN0aW9uKCkge1xyXG5cdFx0cmV0dXJuIGNvbGxlY3Rpb247XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBfY2xlYXIoKSB7XHJcblx0XHRjb2xsZWN0aW9uID0gbnVsbDtcclxuXHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnY29sbGVjdGlvbiBjbGVhcmVkLicgKTtcclxuXHR9XHJcblxyXG5cdHJldHVybiB7XHJcblx0XHRnZXRDb2xsZWN0aW9uLFxyXG5cdFx0Y3JlYXRlLFxyXG5cdFx0Z2V0LFxyXG5cdFx0cHVzaCxcclxuXHRcdHB1dCxcclxuXHRcdHJlbW92ZSxcclxuXHRcdHN5bmMsXHJcblx0XHRfY2xlYXIsXHJcblx0XHRyZXNvbHZlQ29sbGVjdGlvblxyXG5cdH07XHJcblxyXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJyRzY29wZScsICdUTURiJywgJyRjYWNoZUZhY3RvcnknLCAnbW92aWVJdGVtJyxcclxuZnVuY3Rpb24oIGxvZywgJHNjb3BlLCBUTURiLCAkY2FjaGVGYWN0b3J5LCBtb3ZpZUl0ZW0gKSB7XHJcblxyXG5cdHZhciB2bSA9IHRoaXM7XHJcblx0dm0ubW92aWVJdGVtID0gbW92aWVJdGVtOyAvLyBtb3ZpZUl0ZW0gaW5qZWN0ZWQgdmlhIHN0YXRlIHJlc29sdmVcclxuXHRsb2cuZGVidWcoICdjdHJsJywgJ21vdmllRGV0YWlsIGN0cmwgcmVzb2x2ZWQ6Jywgdm0ubW92aWVJdGVtICk7XHJcblxyXG5cdG1vdmllSXRlbS5mdWxsVGl0bGUgPSBtb3ZpZUl0ZW0udGl0bGU7XHJcblx0aWYgKCBtb3ZpZUl0ZW0udGl0bGUgIT09IG1vdmllSXRlbS5vcmlnaW5hbF90aXRsZSApIHtcclxuXHRcdG1vdmllSXRlbS5mdWxsVGl0bGUgPSBtb3ZpZUl0ZW0udGl0bGUgKyAnICgnICsgbW92aWVJdGVtLm9yaWdpbmFsX3RpdGxlICsgJyknO1xyXG5cdH1cclxuXHJcblx0aWYgKCBtb3ZpZUl0ZW0uYmFja2Ryb3BfcGF0aCApIHtcclxuXHRcdHZhciBpbWdVcmwgPSAnaHR0cDovL2ltYWdlLnRtZGIub3JnL3QvcC9vcmlnaW5hbCcgKyBtb3ZpZUl0ZW0uYmFja2Ryb3BfcGF0aDtcclxuXHRcdCQoICcuYmFja2Ryb3AnICkuY3NzKCB7XHJcblx0XHRcdCdiYWNrZ3JvdW5kLWltYWdlJzogJ3VybCgnICsgaW1nVXJsICsgJyknXHJcblx0XHR9ICk7XHJcblx0fVxyXG5cclxuXHR2bS5hZGRUb0NvbGxlY3Rpb24gPSBmdW5jdGlvbiAoKSB7XHJcblx0XHRjb25zb2xlLmxvZyggbW92aWVJdGVtLmlkICk7XHJcblx0XHQvLyBwcm9tcHQgdXAgY29sbGVjdGlvbiBtb2RhbCAtPiBmZXRjaCB1c3IncyBjb2xsZWN0aW9uIC0+IGFsbG93IHVzZXIgdG8gc2VsZWN0IHdoaWNoIGNvbGxlY3Rpb24gdG8gYWRkIHRvIC0+IHNhdmUgdG8gREJcclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgZnVuY3Rpb24gKCkge1xyXG5cclxuXHRmdW5jdGlvbiBkZWJvdW5jZSggZnVuYywgd2FpdCwgaW1tZWRpYXRlICkge1xyXG5cdFx0dmFyIF90aGlzID0gdGhpcyxcclxuXHRcdFx0X2FyZ3VtZW50cyA9IGFyZ3VtZW50cztcclxuXHJcblx0XHR2YXIgdGltZW91dDtcclxuXHRcdHJldHVybiBmdW5jdGlvbiAoKSB7XHJcblxyXG5cdFx0XHR2YXIgY29udGV4dCA9IF90aGlzLFxyXG5cdFx0XHRcdGFyZ3MgPSBfYXJndW1lbnRzO1xyXG5cdFx0XHR2YXIgbGF0ZXIgPSBmdW5jdGlvbiBsYXRlcigpIHtcclxuXHJcblx0XHRcdFx0dGltZW91dCA9IG51bGw7XHJcblx0XHRcdFx0aWYgKCAhaW1tZWRpYXRlICkgZnVuYy5hcHBseSggY29udGV4dCwgYXJncyApO1xyXG5cdFx0XHR9O1xyXG5cdFx0XHR2YXIgY2FsbE5vdyA9IGltbWVkaWF0ZSAmJiAhdGltZW91dDtcclxuXHRcdFx0Y2xlYXJUaW1lb3V0KCB0aW1lb3V0ICk7XHJcblx0XHRcdHRpbWVvdXQgPSBzZXRUaW1lb3V0KCBsYXRlciwgd2FpdCApO1xyXG5cdFx0XHRpZiAoIGNhbGxOb3cgKSBmdW5jLmFwcGx5KCBjb250ZXh0LCBhcmdzICk7XHJcblx0XHR9O1xyXG5cdH1cclxuXHJcblx0cmV0dXJuIHtcclxuXHRcdGRlYm91bmNlXHJcblx0fTtcclxuXHJcbn0gXTtcclxuIl19
