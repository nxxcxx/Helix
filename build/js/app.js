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

module.exports = ['log', '$scope', 'auth', 'movieCollection', function (log, $scope, auth, movieCollection) {

	window.movieCollection = movieCollection;
	log.debug('info', 'collectionCtrl', movieCollection.getCollection());
	var vm = this;
	vm.movieCollection = movieCollection;
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

module.exports = ['log', 'movieCollection', 'collectionModalService', 'EVT', function (log, movieCollection, collectionModalService, EVT) {

		function ctrl($scope, $element, $attrs) {

				var vm = this;
				vm.movieCollection = movieCollection;
				vm.collectionModalService = collectionModalService;

				vm.addingNewCollection = false;

				vm.openEditor = function () {
						vm.addingNewCollection = true;
				};

				vm.closeEditor = function () {
						vm.addingNewCollection = false;
				};

				vm.createNewCollection = function () {
						movieCollection.create($scope.newCollectionName);
						vm.closeEditor();
				};

				vm.addToCollection = function (movieId, collectionName) {
						log.debug('info', 'addToCollection:', movieId, collectionName);
						var success = movieCollection.push(movieId, collectionName);
						log.debug('info', 'movieCollection.push', success);
				};

				// default css at directive initialization
				$element.css({ visibility: 'hidden' });

				EVT.collectionModalOpen.listen(function () {
						log.debug('info', 'collectionModalOpen');
						$element.css({ visibility: 'visible' });
				});

				EVT.collectionModalClose.listen(function () {
						log.debug('info', 'collectionModalClose');
						$element.css({ visibility: 'hidden' });
				});
		}

		return {

				restrict: 'E',
				scope: {},
				controller: ctrl,
				controllerAs: 'modal',
				replace: true,
				templateUrl: './template/collectionModal.html'

		};
}];

},{}],10:[function(require,module,exports){
'use strict';

module.exports = ['log', 'EVT', function (log, EVT) {

	var activeItem = null;

	function setActiveItem(item) {
		activeItem = item;
	}

	function getActiveItem(item) {
		return activeItem;
	}

	function open() {
		EVT.collectionModalOpen.emit();
	}

	function close() {
		EVT.collectionModalClose.emit();
	}

	return {
		setActiveItem: setActiveItem,
		getActiveItem: getActiveItem,
		open: open,
		close: close
	};
}];

},{}],11:[function(require,module,exports){
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

},{}],12:[function(require,module,exports){
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
		},
		collectionModalOpen: {
			listen: function listen(cb) {
				$rootScope.$on('collectionModalOpen', cb);
			},
			emit: function emit() {
				$rootScope.$broadcast('collectionModalOpen');
			}
		},
		collectionModalClose: {
			listen: function listen(cb) {
				$rootScope.$on('collectionModalClose', cb);
			},
			emit: function emit() {
				$rootScope.$broadcast('collectionModalClose');
			}
		}

	};

	return EVT;
}];

},{}],13:[function(require,module,exports){
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

},{}],14:[function(require,module,exports){
'use strict';

module.exports = ['$window', function ($window) {

	var $$ = {
		canvas: null,
		stats: new Stats(),
		scene: new THREE.Scene(),
		width: $(window).width(),
		height: $(window).height(),
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
		$$.width = $(window).width();
		$$.height = $(window).height();
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

},{}],15:[function(require,module,exports){
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

},{}],16:[function(require,module,exports){
'use strict';

module.exports = ['$state', 'collectionModalService', function ($state, collectionModalService) {

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
			collectionModalService.setActiveItem($scope.movieItem);
		});
	}

	return {
		restrict: 'E',
		replace: true,
		controller: ctrl,
		template: '<div class="posterElem"></div>'
	};
}];

},{}],17:[function(require,module,exports){
'use strict';

angular.module('app', ['ui.router', 'ngAnimate']).constant('ENDPOINT_URI', 'http://localhost:8001/').constant('TMDB_API', {
	key: '374c0342a6406dfe0aeb3de2ea042c59',
	url: 'http://api.themoviedb.org/3/'
}).provider('log', require('./debug/log.pv.js')).factory('util', require('./util.js')).controller('mainCtrl', require('./main.ctrl.js')).factory('TMDb', require('./TMDb.fac.js')).factory('EVT', require('./events.fac.js')).controller('movieDetailCtrl', require('./movieDetail.ctrl.js')).directive('display', require('./helix/display.dir.js')).factory('ENGINE', require('./helix/engine.fac.js')).factory('helix', require('./helix/helix.fac.js')).directive('poster', require('./helix/poster.dir.js')).controller('signupCtrl', require('./auth/signup.ctrl.js')).controller('signinCtrl', require('./auth/signin.ctrl.js')).controller('signoutCtrl', require('./auth/signout.ctrl.js')).factory('auth', require('./auth/auth.fac.js')).factory('authToken', require('./auth/authToken.fac.js')).factory('authInterceptor', require('./auth/authInterceptor.fac.js')).controller('movieCollectionCtrl', require('./auth/movieCollection.ctrl.js')).factory('movieCollection', require('./movieCollection.fac.js')).directive('collectionModal', require('./collectionModal.dir.js')).factory('collectionModalService', require('./collectionModalService.fac.js')).config(['$stateProvider', '$urlRouterProvider', '$httpProvider', function ($stateProvider, $urlRouterProvider, $httpProvider) {

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
		controller: 'movieCollectionCtrl',
		controllerAs: 'mc',
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
}]).run(['log', '$rootScope', '$state', 'auth', 'movieCollection', function (log, $rootScope, $state, auth, movieCollection) {

	// todo authorize user every beginning of session
	// todo dont autorize twice
	auth.authorize(true);

	movieCollection.resolveCollection();

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

},{"./TMDb.fac.js":1,"./auth/auth.fac.js":2,"./auth/authInterceptor.fac.js":3,"./auth/authToken.fac.js":4,"./auth/movieCollection.ctrl.js":5,"./auth/signin.ctrl.js":6,"./auth/signout.ctrl.js":7,"./auth/signup.ctrl.js":8,"./collectionModal.dir.js":9,"./collectionModalService.fac.js":10,"./debug/log.pv.js":11,"./events.fac.js":12,"./helix/display.dir.js":13,"./helix/engine.fac.js":14,"./helix/helix.fac.js":15,"./helix/poster.dir.js":16,"./main.ctrl.js":18,"./movieCollection.fac.js":19,"./movieDetail.ctrl.js":20,"./util.js":21}],18:[function(require,module,exports){
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

},{}],19:[function(require,module,exports){
'use strict';

module.exports = ['log', 'ENDPOINT_URI', '$http', '$q', function (log, ENDPOINT_URI, $http, $q) {

	var DB_ENDPOINT = ENDPOINT_URI + 'collection';
	var collection = null;

	function create(name) {
		// collection needs to be resolved first
		// todo check if collection is alredy exists
		collection.push({ collectionName: name, movies: [] });
		put();
	}

	function isEmpty() {
		return collection.length === 0;
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
				log.debug('warn', 'collection.resolveCollection():', err);
				deferred.reject(err);
			});
		}

		return deferred.promise;
	}

	function hasItem(itemId, someCollection) {
		for (var i = 0; i < collection.length; i++) {
			if (collection[i].collectionName === someCollection) {
				for (var k = 0; k < collection[i].movies.length; k++) {
					if (collection[i].movies[k] === itemId) {
						return true;
					}
				}
			}
		}
		return false;
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
		if (hasItem(itemId, toCollection)) {
			return false;
		}
		for (var i = 0; i < collection.length; i++) {
			if (collection[i].collectionName === toCollection) {
				collection[i].movies.push(itemId);
				put();
				return true;
			}
		}
		return false;
	}

	function remove(itemId, inCollection) {
		for (var i = 0; i < collection.length; i++) {
			if (collection[i].collectionName === inCollection) {
				for (var k = 0; k < collection[i].movies.length; k++) {
					if (collection[i].movies[k] === itemId) {
						var removed = collection[i].movies.splice(k, 1).length;
						put();
						return removed !== 0;
					}
				}
			}
		}
		return false;
	}

	function removeCollection(collectionName) {
		for (var i = 0; i < collection.length; i++) {
			if (collection[i].collectionName === collectionName) {
				var removed = collection.splice(i, 1).length;
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
		log.debug('info', 'local collection cleared.');
	}

	return {
		getCollection: getCollection,
		create: create,
		push: push,
		put: put,
		remove: remove,
		removeCollection: removeCollection,
		sync: sync,
		_clear: _clear,
		resolveCollection: resolveCollection,
		hasItem: hasItem,
		isEmpty: isEmpty
	};
}];

},{}],20:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', 'TMDb', '$cacheFactory', 'movieItem', 'collectionModalService', function (log, $scope, TMDb, $cacheFactory, movieItem, collectionModalService) {

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

	vm.openCollectionModal = function () {
		collectionModalService.setActiveItem(movieItem);
		collectionModalService.open();
	};
}];

},{}],21:[function(require,module,exports){
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

},{}]},{},[17])
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9UTURiLmZhYy5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2F1dGgvYXV0aC5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL2F1dGhJbnRlcmNlcHRvci5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL2F1dGhUb2tlbi5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL21vdmllQ29sbGVjdGlvbi5jdHJsLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvYXV0aC9zaWduaW4uY3RybC5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2F1dGgvc2lnbm91dC5jdHJsLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvYXV0aC9zaWdudXAuY3RybC5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2NvbGxlY3Rpb25Nb2RhbC5kaXIuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9jb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLmZhYy5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2RlYnVnL2xvZy5wdi5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2V2ZW50cy5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9oZWxpeC9kaXNwbGF5LmRpci5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2hlbGl4L2VuZ2luZS5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9oZWxpeC9oZWxpeC5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9oZWxpeC9wb3N0ZXIuZGlyLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvaW5kZXguanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9tYWluLmN0cmwuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9tb3ZpZUNvbGxlY3Rpb24uZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvbW92aWVEZXRhaWwuY3RybC5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL3V0aWwuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7OztBQ0FBLE1BQU0sQ0FBQyxPQUFPLEdBQUcsQ0FBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFLElBQUksRUFBRSxjQUFjLEVBQzNGLFVBQVcsR0FBRyxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLGFBQWEsRUFBRSxFQUFFLEVBQUUsWUFBWSxFQUFHOztBQUV2RSxLQUFJLFlBQVksR0FBRyxFQUFFLENBQUM7QUFDdEIsS0FBSSxhQUFhLEdBQUcsQ0FBQyxDQUFDO0FBQ3RCLEtBQUksVUFBVSxHQUFHLENBQUMsQ0FBQyxDQUFDO0FBQ3BCLEtBQUksUUFB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UUFBTztBQUNOLFVBQVEsRUFBUixRQUFRO0VBQ1IsQ0FBQztDQUVGLENBQUUsQ0FBQyIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckaHR0cCcsICdUTURCX0FQSScsICdFVlQnLCAnJGNhY2hlRmFjdG9yeScsICckcScsICdFTkRQT0lOVF9VUkknLFxyXG5mdW5jdGlvbiAoIGxvZywgJGh0dHAsIFRNREJfQVBJLCBFVlQsICRjYWNoZUZhY3RvcnksICRxLCBFTkRQT0lOVF9VUkkgKSB7XHJcblxyXG5cdHZhciBzZWFyY2hSZXN1bHQgPSBbXTtcclxuXHR2YXIgcHJldlJlc3VsdExlbiA9IDA7XHJcblx0dmFyIHRvdGFsUGFnZXMgPSAtMTtcclxuXHR2YXIgY3VyclBhZ2UgPSAxO1xyXG5cclxuXHR2YXIgbW92aWVJZENhY2hlID0gJGNhY2hlRmFjdG9yeSggJ21vdmllSWRDYWNoZScgKTtcclxuXHQvLyBUTURCX0FQSS51cmwgKyAnbW92aWUvbm93X3BsYXlpbmcnXHJcblxyXG5cdHZhciBEQl9FTkRQT0lOVCA9IEVORFBPSU5UX1VSSSArICdtb3ZpZS8nO1xyXG5cclxuXHRmdW5jdGlvbiBwdXRJdGVtVG9EQiggbW92aWVJdGVtICkge1xyXG5cdFx0Ly8gdG9kbyBkb250IHB1dCBleGlzaXRpbmcgaXRlbSBpbiBkYiAoIFVQU0VSVCApXHJcblx0XHQkaHR0cC5wdXQoIERCX0VORFBPSU5UICsgbW92aWVJdGVtLmlkLCBtb3ZpZUl0ZW0gKVxyXG5cdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdpbmZvJywgJ1BVVDonLCByZXMgKTtcclxuXHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdlcnInLCAnUFVUOicsIGVyciApO1xyXG5cdFx0fSApO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gc2VhcmNoSWRGcm9tREIoIGlkICkge1xyXG5cdFx0dmFyIHByb21pc2UgPSAkaHR0cC5nZXQoIERCX0VORFBPSU5UICsgaWQgKVxyXG5cdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdpbmZvJywgJ3NlYXJjaEJ5SWQgPT4gREI6JywgcmVzLmRhdGEgKTtcclxuXHRcdFx0aWYgKCByZXMuZGF0YSApIHtcclxuXHRcdFx0XHRyZXR1cm4gcmVzLmRhdGE7XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0cmV0dXJuIG51bGw7XHJcblx0XHRcdH1cclxuXHRcdH0sIGZ1bmN0aW9uKCBlcnIgKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdzZWFyY2hCeUlkID0+IERCOicsIGVyciApO1xyXG5cdFx0fSApO1xyXG5cdFx0cmV0dXJuIHByb21pc2U7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBzZWFyY2hJZEZyb21BUEkoIGlkICkge1xyXG5cdFx0dmFyIHByb21pc2UgPSAkaHR0cC5nZXQoIFRNREJfQVBJLnVybCArICdtb3ZpZS8nICsgaWQsIHtcclxuXHRcdFx0cGFyYW1zOiB7IGFwaV9rZXk6IFRNREJfQVBJLmtleSB9XHJcblx0XHR9ICkudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnc2VhcmNoQnlJZCA9PiBBUEk6JywgcmVzLmRhdGEgKTtcclxuXHRcdFx0bW92aWVJZENhY2hlLnB1dCggcmVzLmRhdGEuaWQsIHJlcy5kYXRhICk7XHJcblx0XHRcdHB1dEl0ZW1Ub0RCKCByZXMuZGF0YSApO1xyXG5cdFx0XHRyZXR1cm4gcmVzLmRhdGE7XHJcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ3NlYXJjaEJ5SWQgPT4gQVBJOicsIGVyciApO1xyXG5cdFx0fSApO1xyXG5cdFx0cmV0dXJuIHByb21pc2U7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBzZWFyY2hCeUlkKCBpZCApIHtcclxuXHJcblx0XHR2YXIgY2FjaGVkSXRlbSA9IG1vdmllSWRDYWNoZS5nZXQoIGlkICk7XHJcblx0XHRpZiAoIGNhY2hlZEl0ZW0gKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnc2VhcmNoQnlJZCA9PiBjYWNoZTonLCBjYWNoZWRJdGVtICk7XHJcblx0XHRcdHJldHVybiBjYWNoZWRJdGVtO1xyXG5cdFx0fVxyXG5cclxuXHRcdHZhciBkZl9EQiA9ICRxLmRlZmVyKCk7XHJcblx0XHR2YXIgZGZfUmVzID0gJHEuZGVmZXIoKTtcclxuXHJcblx0XHRzZWFyY2hJZEZyb21EQiggaWQgKS50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcclxuXHRcdFx0aWYgKCByZXMgKSB7XHJcblx0XHRcdFx0ZGZfREIucmVzb2x2ZSggcmVzICk7XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0ZGZfREIucmVqZWN0KCAnbm90IGZvdW5kJyApO1xyXG5cdFx0XHR9XHJcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0XHRkZl9EQi5yZWplY3QoIGVyciApO1xyXG5cdFx0fSApO1xyXG5cclxuXHRcdGRmX0RCLnByb21pc2UudGhlbiggZnVuY3Rpb24gKCByZXNfREIgKSB7XHJcblx0XHRcdGRmX1Jlcy5yZXNvbHZlKCByZXNfREIgKTtcclxuXHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xyXG5cdFx0XHRzZWFyY2hJZEZyb21BUEkoIGlkICkudGhlbiggZnVuY3Rpb24gKCByZXNfYXBpICkge1xyXG5cdFx0XHRcdGRmX1Jlcy5yZXNvbHZlKCByZXNfYXBpICk7XHJcblx0XHRcdH0sIGZ1bmN0aW9uICggZXJyX2FwaSApIHtcclxuXHRcdFx0XHRkZl9SZXMucmVqZWN0KCBlcnJfYXBpICk7XHJcblx0XHRcdH0gKTtcclxuXHRcdH0gKTtcclxuXHJcblx0XHRyZXR1cm4gZGZfUmVzLnByb21pc2U7XHJcblxyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gc2VhcmNoQnlUaXRsZSggc2VhcmNoT2JqICkge1xyXG5cclxuXHRcdGlmICggY3VyclBhZ2UgPiB0b3RhbFBhZ2VzICYmIHRvdGFsUGFnZXMgIT09IC0xICkge1xyXG5cdFx0XHQvLyBlbWl0IGV2ZW50IGVuZCBvZiBwYWdlXHJcblx0XHRcdEVWVC5FT1AuZW1pdCgpO1xyXG5cdFx0XHRyZXR1cm47XHJcblx0XHR9XHJcblxyXG5cdFx0JGh0dHAoIHtcclxuXHRcdFx0bWV0aG9kOiAnR0VUJyxcclxuXHRcdFx0Y2FjaGU6IHRydWUsXHJcblx0XHRcdHVybDogVE1EQl9BUEkudXJsICsgJ3NlYXJjaC9tb3ZpZScsXHJcblx0XHRcdHBhcmFtczp7XHJcblx0XHRcdFx0YXBpX2tleTogVE1EQl9BUEkua2V5LFxyXG5cdFx0XHRcdHF1ZXJ5OiBzZWFyY2hPYmoucXVlcnksXHJcblx0XHRcdFx0cGFnZTogY3VyclBhZ2VcclxuXHRcdFx0fVxyXG5cdFx0fSApLnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cdFx0XHQvLyBlbWl0IGV2ZW50IHNlYXJjaCBzdWNjZXNzXHJcblx0XHRcdHNlYXJjaFJlc3VsdCA9IHNlYXJjaFJlc3VsdC5jb25jYXQoIHJlbW92ZU5vUG9zdGVySXRlbXMoIHJlcy5kYXRhLnJlc3VsdHMgKSApO1xyXG5cdFx0XHR0b3RhbFBhZ2VzID0gcmVzLmRhdGEudG90YWxfcGFnZXM7XHJcblx0XHRcdGN1cnJQYWdlICsrO1xyXG5cdFx0XHRwcmV2UmVzdWx0TGVuID0gc2VhcmNoUmVzdWx0Lmxlbmd0aDtcclxuXHRcdFx0bG9nLmRlYnVnKCAnaW5mbycsICdzZWFyY2hCeVRpdGxlOicsIHJlcywgcmVzLmRhdGEgKTtcclxuXHJcblx0XHRcdC8vIGNhY2hlXHJcblx0XHRcdHJlcy5kYXRhLnJlc3VsdHMuZm9yRWFjaCggZnVuY3Rpb24gKCBpdGVtICkge1xyXG5cclxuXHRcdFx0XHRpZiAoICFtb3ZpZUlkQ2FjaGUuZ2V0KCBpdGVtLmlkICkgKSB7XHJcblx0XHRcdFx0XHRtb3ZpZUlkQ2FjaGUucHV0KCBpdGVtLmlkLCBpdGVtICk7XHJcblx0XHRcdFx0XHQvLyBwdXRJdGVtVG9EQiggaXRlbSApOyAvLyB0b2RvIGNoZWNrIGlmIGFscmVhZHkgZXhpdHMgaW4gREJcclxuXHRcdFx0XHR9XHJcblxyXG5cdFx0XHR9ICk7XHJcblxyXG5cdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XHJcblx0XHRcdC8vIGVtaXQgZXZlbnQgc2VhcmNoIGVyclxyXG5cdFx0XHRsb2cuZGVidWcoICdzZWFyY2hCeVRpdGxlOicsIGVyciApO1xyXG5cdFx0fSApO1xyXG5cclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIHJlbW92ZU5vUG9zdGVySXRlbXMoIHJlc3VsdHMgKSB7XHJcblx0XHRyZXR1cm4gcmVzdWx0cy5maWx0ZXIoIGZ1bmN0aW9uICggaXRlbSApIHtcclxuXHRcdFx0cmV0dXJuICEhaXRlbS5wb3N0ZXJfcGF0aDtcclxuXHRcdH0gKTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIGdldFJlcygpIHtcclxuXHRcdHJldHVybiBzZWFyY2hSZXN1bHQ7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBjbGVhclNlYXJjaCgpIHtcclxuXHRcdC8vIGVtaXQgZXZlbnQgY2xlYXJTZWFjaFxyXG5cdFx0c2VhcmNoUmVzdWx0Lmxlbmd0aCA9IDA7XHJcblx0XHRwcmV2UmVzdWx0TGVuID0gMDtcclxuXHRcdHRvdGFsUGFnZXMgPSAtMTtcclxuXHRcdGN1cnJQYWdlID0gMTtcclxuXHR9XHJcblxyXG5cdHJldHVybiB7XHJcblx0XHRzZWFyY2hCeVRpdGxlLFxyXG5cdFx0c2VhcmNoQnlJZCxcclxuXHRcdGNsZWFyU2VhcmNoLFxyXG5cdFx0Z2V0UmVzLFxyXG5cdFx0cHJldlJlc3VsdExlbixcclxuXHRcdHB1dEl0ZW1Ub0RCXHJcblx0fTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnRU5EUE9JTlRfVVJJJywgJyRodHRwJywgJyRxJywgJ2F1dGhUb2tlbicsXG5mdW5jdGlvbiAoIGxvZywgRU5EUE9JTlRfVVJJLCAkaHR0cCwgJHEsIGF1dGhUb2tlbiApIHtcblxuXHRcdHZhciBpZGVudGl0eSA9IG51bGw7XG5cdFx0dmFyIF9pZGVudGl0eVJlc29sdmVkID0gZmFsc2U7XG5cblx0XHRmdW5jdGlvbiBhdXRob3JpemUoIGZvcmNlICkge1xuXG5cdFx0XHR2YXIgZGVmZXJyZWQgPSAkcS5kZWZlcigpO1xuXG5cdFx0XHRpZiAoIGZvcmNlICkgaWRlbnRpdHkgPSBudWxsO1xuXG5cdFx0XHRpZiAoIGlkZW50aXR5ICE9PSBudWxsICkge1xuXG5cdFx0XHRcdGRlZmVycmVkLnJlc29sdmUoIHRydWUgKTtcblxuXHRcdFx0fSBlbHNlIHtcblxuXHRcdFx0XHQkaHR0cC5nZXQoIEVORFBPSU5UX1VSSSArICdhdXRoJywgeyByZXF1aXJlQXV0aDogdHJ1ZSB9IClcblx0XHRcdFx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XG5cblx0XHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnYXV0aC5hdXRob3JpemUoKTonLCByZXMsIHJlcy5kYXRhICk7XG5cdFx0XHRcdFx0XHRpZGVudGl0eSA9IHJlcy5kYXRhO1xuXHRcdFx0XHRcdFx0X2lkZW50aXR5UmVzb2x2ZWQgPSB0cnVlO1xuXHRcdFx0XHRcdFx0ZGVmZXJyZWQucmVzb2x2ZSggdHJ1ZSApO1xuXG5cdFx0XHRcdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XG5cblx0XHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ3dhcm4nLCAnYXV0aG9yaXplJywgZXJyLCBlcnIuZGF0YSApO1xuXHRcdFx0XHRcdFx0Ly8gdG9kbyBpZiBqd3QgZXhwaXJlZCAsIGRlYXV0aG9yaXplLCByZW1vdmUgbG9jYWwgc3RvcmFnZSwgcmVkaXJlY3Rcblx0XHRcdFx0XHRcdF9pZGVudGl0eVJlc29sdmVkID0gdHJ1ZTtcblx0XHRcdFx0XHRcdGRlZmVycmVkLnJlamVjdCggZXJyICk7XG5cblx0XHRcdFx0XHR9ICk7XG5cblx0XHRcdH1cblxuXHRcdFx0cmV0dXJuIGRlZmVycmVkLnByb21pc2U7XG5cblx0XHR9XG5cblx0XHRmdW5jdGlvbiBkZWF1dGhvcml6ZSgpIHtcblx0XHRcdGF1dGhUb2tlbi5yZW1vdmVUb2tlbigpO1xuXHRcdFx0aWRlbnRpdHkgPSBudWxsO1xuXHRcdH1cblxuXHRcdGZ1bmN0aW9uIGlzQXV0aGVudGljYXRlZCgpIHtcblx0XHRcdHJldHVybiBpZGVudGl0eSAhPT0gbnVsbDtcblx0XHR9XG5cblx0XHRmdW5jdGlvbiBpZGVudGl0eVJlc29sdmVkKCkge1xuXHRcdFx0cmV0dXJuIF9pZGVudGl0eVJlc29sdmVkO1xuXHRcdH1cblxuXHRcdHJldHVybiB7XG5cblx0XHRcdGF1dGhvcml6ZSxcblx0XHRcdGRlYXV0aG9yaXplLFxuXHRcdFx0aXNBdXRoZW50aWNhdGVkLFxuXHRcdFx0aWRlbnRpdHlSZXNvbHZlZFxuXG5cdFx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdhdXRoVG9rZW4nLCBmdW5jdGlvbiAoIGF1dGhUb2tlbiApIHtcblxuXHRmdW5jdGlvbiByZXF1ZXN0KCBjb25maWcgKSB7XG5cblx0XHRpZiAoIGNvbmZpZy5yZXF1aXJlQXV0aCApIHtcblx0XHRcdHZhciB0b2tlbiA9IGF1dGhUb2tlbi5nZXRUb2tlbigpO1xuXHRcdFx0aWYgKCB0b2tlbiApIHtcblx0XHRcdFx0Ly8gaHR0cDovL3NlbGYtaXNzdWVkLmluZm8vZG9jcy9kcmFmdC1pZXRmLW9hdXRoLXYyLWJlYXJlci5odG1sICAgc2VjdGlvbiAyLjFcblx0XHRcdFx0Ly8gaHR0cHM6Ly9kZXZlbG9wZXJzLmdvb2dsZS5jb20vZ21haWwvbWFya3VwL2FjdGlvbnMvdmVyaWZ5aW5nLWJlYXJlci10b2tlbnNcblx0XHRcdFx0Ly8gaHR0cDovL3d3dy53My5vcmcvUHJvdG9jb2xzL3JmYzI2MTYvcmZjMjYxNi1zZWM0Lmh0bWwgc2VjdGlvbiA0LjIgaGVhZGVyIGZpZWxkIG5hbWUgY2FzZSBpbnNlbnNpdGl2ZVxuXHRcdFx0XHRjb25maWcuaGVhZGVycy5BdXRob3JpemF0aW9uID0gJ0JlYXJlciAnICsgdG9rZW47XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0cmV0dXJuIGNvbmZpZztcblxuXHR9XG5cblx0ZnVuY3Rpb24gcmVzcG9uc2UoIHJlcyApIHtcblx0XHRyZXR1cm4gcmVzO1xuXHR9XG5cblx0cmV0dXJuIHtcblxuXHRcdHJlcXVlc3QsXG5cdFx0cmVzcG9uc2VcblxuXHR9O1xuXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJyR3aW5kb3cnLCBmdW5jdGlvbiAoIGxvZywgJHdpbmRvdyApIHtcblxuXHR2YXIgc3RvcmFnZSA9ICR3aW5kb3cubG9jYWxTdG9yYWdlO1xuXHR2YXIgY2FjaGVkVG9rZW4gPSBudWxsO1xuXG5cdGZ1bmN0aW9uIHNldFRva2VuKCB0b2tlbiApIHtcblx0XHRjYWNoZWRUb2tlbiA9IHRva2VuO1xuXHRcdHN0b3JhZ2Uuc2V0SXRlbSggJ2p3dCcsIHRva2VuICk7XG5cdH1cblxuXHRmdW5jdGlvbiBnZXRUb2tlbigpIHtcblx0XHRpZiAoICFjYWNoZWRUb2tlbiApIHtcblx0XHRcdGNhY2hlZFRva2VuID0gc3RvcmFnZS5nZXRJdGVtKCAnand0JyApO1xuXHRcdH1cblx0XHRyZXR1cm4gY2FjaGVkVG9rZW47XG5cdH1cblxuXHRmdW5jdGlvbiByZW1vdmVUb2tlbigpIHtcblx0XHRjYWNoZWRUb2tlbiA9IG51bGw7XG5cdFx0c3RvcmFnZS5yZW1vdmVJdGVtKCAnand0JyApO1xuXHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAndG9rZW4gcmVtb3ZlZCcgKTtcblx0fVxuXG5cdGZ1bmN0aW9uIGhhc1Rva2VuKCkge1xuXHRcdHJldHVybiAhIWdldFRva2VuKCk7XG5cdH1cblxuXHRyZXR1cm4ge1xuXG5cdFx0c2V0VG9rZW4sXG5cdFx0Z2V0VG9rZW4sXG5cdFx0cmVtb3ZlVG9rZW4sXG5cdFx0aGFzVG9rZW5cblxuXHR9O1xuXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJyRzY29wZScsICdhdXRoJywgJ21vdmllQ29sbGVjdGlvbicsIGZ1bmN0aW9uICggbG9nLCAkc2NvcGUsIGF1dGgsIG1vdmllQ29sbGVjdGlvbiApICB7XHJcblxyXG5cdHdpbmRvdy5tb3ZpZUNvbGxlY3Rpb24gPSBtb3ZpZUNvbGxlY3Rpb247XHJcblx0bG9nLmRlYnVnKCAnaW5mbycsICdjb2xsZWN0aW9uQ3RybCcsIG1vdmllQ29sbGVjdGlvbi5nZXRDb2xsZWN0aW9uKCkgKTtcclxuXHR2YXIgdm0gPSB0aGlzO1xyXG5cdHZtLm1vdmllQ29sbGVjdGlvbiA9IG1vdmllQ29sbGVjdGlvbjtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJyRodHRwJywgJ0VORFBPSU5UX1VSSScsICdhdXRoVG9rZW4nLCAnJHN0YXRlJyxcclxuZnVuY3Rpb24gKCBsb2csICRzY29wZSwgJGh0dHAsIEVORFBPSU5UX1VSSSwgYXV0aFRva2VuLCAkc3RhdGUgKSAge1xyXG5cclxuXHR2YXIgdm0gPSB0aGlzO1xyXG5cdHZtLnVzZXIgPSB7XHJcblx0XHRlbWFpbDogJycsXHJcblx0XHRwYXNzd29yZDogJydcclxuXHR9O1xyXG5cclxuXHR2bS5zaWduaW4gPSBmdW5jdGlvbigpIHtcclxuXHJcblx0XHRpZiAoIHZtLnVzZXIuZW1haWwgPT09ICcnIHx8IHZtLnVzZXIucGFzc3dvcmQgPT09ICcnICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICd3YXJuJywgJ2VtYWlsICYgcGFzc3dvcmQgcmVxdWlyZWQuJyApO1xyXG5cdFx0XHRyZXR1cm47XHJcblx0XHR9XHJcblxyXG5cdFx0JGh0dHAucG9zdCggRU5EUE9JTlRfVVJJICsgJ3NpZ25pbicsIHZtLnVzZXIgKVxyXG5cdFx0XHQudGhlbiggZnVuY3Rpb24oIHJlcyApIHtcclxuXHRcdFx0XHRsb2cuZGVidWcoICdpbmZvJywgJ3NpZ25pbicsIHJlcywgcmVzLmRhdGEgKTtcclxuXHRcdFx0XHRhdXRoVG9rZW4uc2V0VG9rZW4oIHJlcy5kYXRhLnRva2VuICk7XHJcblx0XHRcdFx0JHN0YXRlLmdvKCAnY29sbGVjdGlvbicgKTtcclxuXHRcdFx0fSwgZnVuY3Rpb24oIGVyciwgc3RhdHVzICkge1xyXG5cdFx0XHRcdGxvZy5kZWJ1ZyggJ3dhcm4nLCAnc2lnbmluJywgZXJyICk7XHJcblx0XHRcdH0gKTtcclxuXHJcblx0fTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckc3RhdGUnLCAnYXV0aCcsICdtb3ZpZUNvbGxlY3Rpb24nLCBmdW5jdGlvbiAoICRzdGF0ZSwgYXV0aCwgbW92aWVDb2xsZWN0aW9uICkgIHtcclxuXHJcblx0YXV0aC5kZWF1dGhvcml6ZSgpO1xyXG5cdG1vdmllQ29sbGVjdGlvbi5fY2xlYXIoKTtcclxuXHQkc3RhdGUuZ28oICdzaWduaW4nICk7XHJcblxyXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJyRzY29wZScsICckaHR0cCcsICdFTkRQT0lOVF9VUkknLCAnYXV0aFRva2VuJywgJyRzdGF0ZScsXG5mdW5jdGlvbiAoIGxvZywgJHNjb3BlLCAkaHR0cCwgRU5EUE9JTlRfVVJJLCBhdXRoVG9rZW4sICRzdGF0ZSApIHtcblxuXHRcdHZhciB2bSA9IHRoaXM7XG5cdFx0dm0udXNlciA9IHt9O1xuXG5cdFx0dm0uc2lnbnVwID0gZnVuY3Rpb24gKCkge1xyXG5cblx0XHRcdGlmICggdm0udXNlci5lbWFpbCA9PT0gdW5kZWZpbmVkIHx8IHZtLnVzZXIucGFzc3dvcmQgPT09IHVuZGVmaW5lZCApIHtcblx0XHRcdFx0bG9nLmRlYnVnKCAnd2FybicsICdlbWFpbCAmIHBhc3N3b3JkIHJlcXVpcmVkLicgKTtcblx0XHRcdFx0cmV0dXJuO1xuXHRcdFx0fVxuXG5cdFx0XHRsb2cuZGVidWcoICd3YXJuJywgJ3NpZ25pbmcgdXAuLi4nICk7XHJcblx0XHRcdCRodHRwLnBvc3QoIEVORFBPSU5UX1VSSSArICdzaWdudXAnLCB2bS51c2VyIClcclxuXHRcdFx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblxuXHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnUmVnaXN0ZXJlZC4nICk7XHJcblx0XHRcdFx0XHRsb2cuZGVidWcoICdpbmZvJywgcmVzICk7XHJcblxyXG5cdFx0XHRcdFx0YXV0aFRva2VuLnNldFRva2VuKCByZXMuZGF0YS50b2tlbiApO1xyXG5cdFx0XHRcdFx0JHN0YXRlLmdvKCAnY29sbGVjdGlvbicgKTtcclxuXG5cdFx0XHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xyXG5cblx0XHRcdFx0XHRsb2cuZGVidWcoICd3YXJuJywgZXJyICk7XG5cdFx0XHRcdFx0dm0uZm9ybS4kc3VibWl0dGVkID0gZmFsc2U7XHJcblxuXHRcdFx0XHR9ICk7XHJcblxuXHRcdH07XG5cbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnbW92aWVDb2xsZWN0aW9uJywgJ2NvbGxlY3Rpb25Nb2RhbFNlcnZpY2UnLCAnRVZUJyxcclxuZnVuY3Rpb24gKCBsb2csIG1vdmllQ29sbGVjdGlvbiwgY29sbGVjdGlvbk1vZGFsU2VydmljZSwgRVZUICkge1xyXG5cclxuXHRmdW5jdGlvbiBjdHJsKCAkc2NvcGUsICRlbGVtZW50LCAkYXR0cnMgKSB7XHJcblxyXG5cdFx0dmFyIHZtID0gdGhpcztcclxuXHRcdHZtLm1vdmllQ29sbGVjdGlvbiA9IG1vdmllQ29sbGVjdGlvbjtcclxuXHRcdHZtLmNvbGxlY3Rpb25Nb2RhbFNlcnZpY2UgPSBjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlO1xyXG5cclxuXHRcdHZtLmFkZGluZ05ld0NvbGxlY3Rpb24gPSBmYWxzZTtcclxuXHJcblx0XHR2bS5vcGVuRWRpdG9yID0gZnVuY3Rpb24gKCkge1xyXG5cdFx0XHR2bS5hZGRpbmdOZXdDb2xsZWN0aW9uID0gdHJ1ZTtcclxuXHRcdH07XHJcblxyXG5cdFx0dm0uY2xvc2VFZGl0b3IgPSBmdW5jdGlvbiAoKSB7XHJcblx0XHRcdHZtLmFkZGluZ05ld0NvbGxlY3Rpb24gPSBmYWxzZTtcclxuXHRcdH07XHJcblxyXG5cdFx0dm0uY3JlYXRlTmV3Q29sbGVjdGlvbiA9IGZ1bmN0aW9uICgpIHtcclxuXHRcdFx0bW92aWVDb2xsZWN0aW9uLmNyZWF0ZSggJHNjb3BlLm5ld0NvbGxlY3Rpb25OYW1lICk7XHJcblx0XHRcdHZtLmNsb3NlRWRpdG9yKCk7XHJcblx0XHR9O1xyXG5cclxuXHRcdHZtLmFkZFRvQ29sbGVjdGlvbiA9IGZ1bmN0aW9uICggbW92aWVJZCwgY29sbGVjdGlvbk5hbWUgKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnYWRkVG9Db2xsZWN0aW9uOicsIG1vdmllSWQsIGNvbGxlY3Rpb25OYW1lICk7XHJcblx0XHRcdHZhciBzdWNjZXNzID0gbW92aWVDb2xsZWN0aW9uLnB1c2goIG1vdmllSWQsIGNvbGxlY3Rpb25OYW1lICk7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnbW92aWVDb2xsZWN0aW9uLnB1c2gnLCBzdWNjZXNzICk7XHJcblx0XHR9O1xyXG5cclxuXHRcdC8vIGRlZmF1bHQgY3NzIGF0IGRpcmVjdGl2ZSBpbml0aWFsaXphdGlvblxyXG5cdFx0JGVsZW1lbnQuY3NzKCB7IHZpc2liaWxpdHk6ICdoaWRkZW4nIH0gKTtcclxuXHJcblx0XHRFVlQuY29sbGVjdGlvbk1vZGFsT3Blbi5saXN0ZW4oIGZ1bmN0aW9uICgpIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnaW5mbycsICdjb2xsZWN0aW9uTW9kYWxPcGVuJyApO1xyXG5cdFx0JGVsZW1lbnQuY3NzKCB7IHZpc2liaWxpdHk6ICd2aXNpYmxlJyB9ICk7XHJcblx0XHR9ICk7XHJcblxyXG5cdFx0RVZULmNvbGxlY3Rpb25Nb2RhbENsb3NlLmxpc3RlbiggZnVuY3Rpb24gKCkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdpbmZvJywgJ2NvbGxlY3Rpb25Nb2RhbENsb3NlJyApO1xyXG5cdFx0JGVsZW1lbnQuY3NzKCB7IHZpc2liaWxpdHk6ICdoaWRkZW4nIH0gKTtcclxuXHRcdH0gKTtcclxuXHJcblx0fVxyXG5cclxuXHRyZXR1cm4ge1xyXG5cclxuXHRcdHJlc3RyaWN0OiAnRScsXHJcblx0XHRzY29wZToge30sXHJcblx0XHRjb250cm9sbGVyOiBjdHJsLFxyXG5cdFx0Y29udHJvbGxlckFzOiAnbW9kYWwnLFxyXG5cdFx0cmVwbGFjZTogdHJ1ZSxcclxuXHRcdHRlbXBsYXRlVXJsOiAnLi90ZW1wbGF0ZS9jb2xsZWN0aW9uTW9kYWwuaHRtbCdcclxuXHJcblx0fTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnRVZUJywgZnVuY3Rpb24gKCBsb2csIEVWVCApIHtcclxuXHJcblx0dmFyIGFjdGl2ZUl0ZW0gPSBudWxsO1xyXG5cclxuXHRmdW5jdGlvbiBzZXRBY3RpdmVJdGVtKCBpdGVtICkge1xyXG5cdFx0YWN0aXZlSXRlbSA9IGl0ZW07XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBnZXRBY3RpdmVJdGVtKCBpdGVtICkge1xyXG5cdFx0cmV0dXJuIGFjdGl2ZUl0ZW07XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBvcGVuKCkge1xyXG5cdFx0RVZULmNvbGxlY3Rpb25Nb2RhbE9wZW4uZW1pdCgpO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gY2xvc2UoKSB7XHJcblx0XHRFVlQuY29sbGVjdGlvbk1vZGFsQ2xvc2UuZW1pdCgpO1xyXG5cdH1cclxuXHJcblx0cmV0dXJuIHtcclxuXHRcdHNldEFjdGl2ZUl0ZW0sXHJcblx0XHRnZXRBY3RpdmVJdGVtLFxyXG5cdFx0b3BlbixcclxuXHRcdGNsb3NlXHJcblx0fTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbIGZ1bmN0aW9uICgpIHtcblxuXHR2YXIgZGVidWdFbmFibGVkID0gZmFsc2U7XG5cdHZhciBkZWJ1Z05hbWVzcGFjZXMgPSBbXTtcblxuXHR0aGlzLmVuYWJsZURlYnVnID0gZnVuY3Rpb24gKCkge1xuXHRcdGRlYnVnRW5hYmxlZCA9IHRydWU7XG5cdH07XG5cblx0dGhpcy5lbmFibGVEZWJ1Z05hbWVzcGFjZSA9IGZ1bmN0aW9uICgpIHtcblx0XHRmb3IgKCBsZXQgaSA9IDA7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKysgKSB7XG5cdFx0XHRkZWJ1Z05hbWVzcGFjZXMucHVzaCggYXJndW1lbnRzWyBpIF0gKTtcblx0XHR9XG5cdH07XG5cblx0dGhpcy4kZ2V0ID0gKCkgPT4ge1xuXG5cdFx0ZnVuY3Rpb24gZGVidWcoKSB7XG5cdFx0XHRpZiAoICFkZWJ1Z0VuYWJsZWQgKSByZXR1cm47XHJcblx0XHRcdHZhciBkZWJ1Z05hbWUgPSBhcmd1bWVudHNbIDAgXTtcclxuXHRcdFx0dmFyIHNsaWNlZEFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbCggYXJndW1lbnRzLCAxICk7XHJcblx0XHRcdGlmICggZGVidWdOYW1lID09PSAnZXJyJyApIHtcclxuXHRcdFx0XHRjb25zb2xlLmVycm9yLmFwcGx5KCBjb25zb2xlLCBzbGljZWRBcmdzICk7XHJcblx0XHRcdH0gZWxzZSBpZiAoIGRlYnVnTmFtZSA9PT0gJ2luZm8nICkge1xyXG5cdFx0XHRcdGNvbnNvbGUuaW5mby5hcHBseSggY29uc29sZSwgc2xpY2VkQXJncyApO1xyXG5cdFx0XHR9IGVsc2UgaWYgKCBkZWJ1Z05hbWUgPT09ICd3YXJuJyApIHtcclxuXHRcdFx0XHRjb25zb2xlLndhcm4uYXBwbHkoIGNvbnNvbGUsIHNsaWNlZEFyZ3MgKTtcclxuXHRcdFx0fSBlbHNlIGlmICggZGVidWdOYW1lc3BhY2VzLmluZGV4T2YoIGRlYnVnTmFtZSApICE9PSAtMSApIHtcclxuXHRcdFx0XHRjb25zb2xlLmxvZy5hcHBseSggY29uc29sZSwgc2xpY2VkQXJncyApO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdHJldHVybiB7XG5cdFx0XHRkZWJ1Z1xuXHRcdH07XG5cblx0fTtcblxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyRyb290U2NvcGUnLCBmdW5jdGlvbiAoICRyb290U2NvcGUgKSB7XHJcblxyXG5cdHZhciBFVlQgPSB7XHJcblxyXG5cdFx0RU9QOiB7XHJcblx0XHRcdGxpc3RlbjogZnVuY3Rpb24gKCBjYiApIHsgJHJvb3RTY29wZS4kb24oICdFT1AnLCBjYiApOyB9LFxyXG5cdFx0XHRlbWl0OiBmdW5jdGlvbiAoKSB7ICRyb290U2NvcGUuJGJyb2FkY2FzdCggJ0VPUCcgKTsgfVxyXG5cdFx0fSxcclxuXHRcdGNvbGxlY3Rpb25Nb2RhbE9wZW46IHtcclxuXHRcdFx0bGlzdGVuOiBmdW5jdGlvbiAoIGNiICkgeyAkcm9vdFNjb3BlLiRvbiggJ2NvbGxlY3Rpb25Nb2RhbE9wZW4nLCBjYiApOyB9LFxyXG5cdFx0XHRlbWl0OiBmdW5jdGlvbiAoKSB7ICRyb290U2NvcGUuJGJyb2FkY2FzdCggJ2NvbGxlY3Rpb25Nb2RhbE9wZW4nICk7IH1cclxuXHRcdH0sXHJcblx0XHRjb2xsZWN0aW9uTW9kYWxDbG9zZToge1xyXG5cdFx0XHRsaXN0ZW46IGZ1bmN0aW9uICggY2IgKSB7ICRyb290U2NvcGUuJG9uKCAnY29sbGVjdGlvbk1vZGFsQ2xvc2UnLCBjYiApOyB9LFxyXG5cdFx0XHRlbWl0OiBmdW5jdGlvbiAoKSB7ICRyb290U2NvcGUuJGJyb2FkY2FzdCggJ2NvbGxlY3Rpb25Nb2RhbENsb3NlJyApOyB9XHJcblx0XHR9XHJcblxyXG5cdH07XHJcblxyXG5cdHJldHVybiBFVlQ7XHJcblxyXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJHdpbmRvdycsICdFTkdJTkUnLCAndXRpbCcsIGZ1bmN0aW9uICggJHdpbmRvdywgRU5HSU5FLCB1dGlsICkge1xuXG5cdGZ1bmN0aW9uIGN0cmwoICRzY29wZSwgJGVsZW1lbnQgKSB7XG5cblx0XHRFTkdJTkUuYXR0YWNoUmVuZGVyZXIoICRlbGVtZW50ICk7XHJcblx0XHQkKCAkd2luZG93ICkub24oICdyZXNpemUnLCB1dGlsLmRlYm91bmNlKCBFTkdJTkUub25XaW5kb3dSZXNpemUsIDEwMCApICk7XHJcblx0XHQkZWxlbWVudC5vbiggJ3doZWVsJywgZnVuY3Rpb24gKCBldnQgKSB7XG5cdFx0XHRFTkdJTkUuJCQud2hlZWxfZHkgPSAtTWF0aC5zaWduKCBldnQub3JpZ2luYWxFdmVudC5kZWx0YVkgKTtcblx0XHR9ICk7XG5cclxuXHRcdEVOR0lORS5zdGFydCgpO1xuXG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdHJlc3RyaWN0OiAnRScsXG5cdFx0cmVwbGFjZTogdHJ1ZSxcblx0XHRjb250cm9sbGVyOiBjdHJsLFxuXHRcdHRlbXBsYXRlOiAnPGRpdiBpZD1cImNhbnZhcy1jb250YWluZXJcIj48L2Rpdj4nXG5cdH07XG5cbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckd2luZG93JywgZnVuY3Rpb24gKCAkd2luZG93ICkge1xuXG5cdHZhciAkJCA9IHtcblx0XHRjYW52YXM6IG51bGwsXG5cdFx0c3RhdHM6IG5ldyBTdGF0cygpLFxuXHRcdHNjZW5lOiBuZXcgVEhSRUUuU2NlbmUoKSxcblx0XHR3aWR0aDogJCh3aW5kb3cpLndpZHRoKCksXG5cdFx0aGVpZ2h0OiAkKHdpbmRvdykuaGVpZ2h0KCksXG5cdFx0Y2FtZXJhOiBuZXcgVEhSRUUuUGVyc3BlY3RpdmVDYW1lcmEoIDcwLCB0aGlzLndpZHRoIC8gdGhpcy5oZWlnaHQsIDEwLCAxMDAwMDAgKSxcblx0XHRyZW5kZXJlcjogbmV3IFRIUkVFLkNTUzNEUmVuZGVyZXIoKSxcblx0XHRzY3JlZW5fcmF0aW86IHRoaXMud2lkdGggLyB0aGlzLmhlaWdodCxcblx0XHRwaXhlbF9yYXRpbzogJHdpbmRvdy5kZXZpY2VQaXhlbFJhdGlvIHx8IDEsXG5cdFx0bW91c2VfeDogdGhpcy53aWR0aCAqIDAuNSxcblx0XHRtb3VzZV95OiB0aGlzLmhlaWdodCAqIDAuNSxcblx0XHR3aGVlbF9keTogMFxuXHR9O1xuXG5cdCQkLnJlbmRlcmVyLnNldFNpemUoICQkLndpZHRoLCAkJC5oZWlnaHQgKTtcblxuXHRmdW5jdGlvbiBhdHRhY2hSZW5kZXJlciggY2FudmFzICkge1xuXHRcdCQkLmNhbnZhcyA9IGNhbnZhcztcblx0XHRjYW52YXMuYXBwZW5kKCAkJC5yZW5kZXJlci5kb21FbGVtZW50ICk7XG5cdFx0Y2FudmFzLmFwcGVuZCggJCQuc3RhdHMuZG9tRWxlbWVudCApO1xuXHR9XG5cblx0ZnVuY3Rpb24gb25XaW5kb3dSZXNpemUoKSB7XG5cdFx0JCQud2lkdGggPSAkKHdpbmRvdykud2lkdGgoKTtcblx0XHQkJC5oZWlnaHQgPSAkKHdpbmRvdykuaGVpZ2h0KCk7XG5cdFx0JCQucGl4ZWxfcmF0aW8gPSAkd2luZG93LmRldmljZVBpeGVsUmF0aW8gfHwgMTtcblx0XHQkJC5zY3JlZW5fcmF0aW8gPSAkJC53aWR0aCAvICQkLmhlaWdodDtcblx0XHQkJC5jYW1lcmEuYXNwZWN0ID0gJCQuc2NyZWVuX3JhdGlvO1xuXHRcdCQkLmNhbWVyYS51cGRhdGVQcm9qZWN0aW9uTWF0cml4KCk7XG5cdFx0JCQucmVuZGVyZXIuc2V0U2l6ZSggJCQud2lkdGgsICQkLmhlaWdodCApO1xuXHR9XG5cblx0ZnVuY3Rpb24gc2V0dXAoKSB7XG5cblx0fVxuXG5cdGZ1bmN0aW9uIHVwZGF0ZSgpIHtcblxuXHRcdGlmICggTWF0aC5hYnMoICQkLndoZWVsX2R5ICkgPiAwLjAwMSApIHtcblx0XHRcdCQkLmNhbWVyYS5wb3NpdGlvbi55ICs9ICQkLndoZWVsX2R5ICogMS4wO1xuXHRcdFx0JCQuY2FtZXJhLnJvdGF0ZVkoICQkLndoZWVsX2R5ICogMC4wMjUgKTtcblx0XHRcdCQkLndoZWVsX2R5ICo9IDAuOTU7XG5cdFx0fVxuXG5cdH1cblxuXHQvLyAtLS0tICBkcmF3IGxvb3Bcblx0ZnVuY3Rpb24gcnVuKCkge1xuXG5cdFx0cmVxdWVzdEFuaW1hdGlvbkZyYW1lKCBydW4gKTtcblx0XHR1cGRhdGUoKTtcblx0XHQkJC5yZW5kZXJlci5yZW5kZXIoICQkLnNjZW5lLCAkJC5jYW1lcmEgKTtcblx0XHQkJC5zdGF0cy51cGRhdGUoKTtcblxuXHR9XG5cblx0ZnVuY3Rpb24gc3RhcnQoKSB7XG5cdFx0c2V0dXAoKTtcblx0XHRydW4oKTtcblx0fVxuXG5cdGZ1bmN0aW9uIHJlc2V0Q2FtZXJhKCkge1xuXHRcdCQkLmNhbWVyYS5wb3NpdGlvbi5zZXQoIDAsIDAsIDAgKTtcblx0XHQkJC5jYW1lcmEucm90YXRpb24uc2V0KCAwLCAwLCAwICk7XG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdCQkLFxuXHRcdGF0dGFjaFJlbmRlcmVyLFxuXHRcdG9uV2luZG93UmVzaXplLFxuXHRcdHN0YXJ0LFxuXHRcdHJlc2V0Q2FtZXJhLFxuXHR9O1xuXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJ0VOR0lORScsICckY29tcGlsZScsICckcm9vdFNjb3BlJyxcclxuZnVuY3Rpb24gKCBsb2csIEVOR0lORSwgJGNvbXBpbGUsICRyb290U2NvcGUgKSB7XHJcblxuXHR2YXIgYWxsUG9zdGVycyA9IG5ldyBUSFJFRS5PYmplY3QzRCgpO1xuXHRFTkdJTkUuJCQuc2NlbmUuYWRkKCBhbGxQb3N0ZXJzICk7XG5cblx0ZnVuY3Rpb24gbWFrZUhlbGl4UG9zdGVycyggcG9zdGVyT2JqZWN0TXVsdGksIG9mZnNldFN0YXJ0SWR4ICkge1xuXHJcblx0XHR2YXIgdmVjdG9yID0gbmV3IFRIUkVFLlZlY3RvcjMoKTtcclxuXHRcdHZhciByYWRpdXMgPSA5MDA7XHJcblx0XHRmb3IgKCB2YXIgaSA9IDA7IGkgPCBwb3N0ZXJPYmplY3RNdWx0aS5sZW5ndGg7IGkrKyApIHtcblxuXHRcdFx0dmFyICRpc29sYXRlZFNjb3BlID0gJHJvb3RTY29wZS4kbmV3KCB0cnVlICk7XG5cdFx0XHQkaXNvbGF0ZWRTY29wZS5tb3ZpZUl0ZW0gPSBwb3N0ZXJPYmplY3RNdWx0aVsgaSBdO1xyXG5cclxuXHRcdFx0dmFyIHBvc3RlckRpcmVjdGl2ZUVsZW0gPSAkY29tcGlsZSggJzxwb3N0ZXI+PC9wb3N0ZXI+JyApKCAkaXNvbGF0ZWRTY29wZSApWyAwIF07XG5cdFx0XHR2YXIgY3NzM2RPYmogPSBuZXcgVEhSRUUuQ1NTM0RPYmplY3QoIHBvc3RlckRpcmVjdGl2ZUVsZW0gKTtcclxuXHJcblx0XHRcdC8vIHRhZyBhbG9nIGFuIGlzb2xhdGVkU2NvcGUgdG8gYmUgZGVzdHJveSB3aGVuIGRpc3Bvc2UgYW4gZWxlbWVudFxyXG5cdFx0XHRjc3MzZE9iai5zY29wZSA9ICRpc29sYXRlZFNjb3BlO1xyXG5cclxuXHRcdFx0dmFyIGhpZHggPSBpICsgb2Zmc2V0U3RhcnRJZHg7XG5cdFx0XHR2YXIgcGhpID0gaGlkeCAqIDAuMTc1ICsgTWF0aC5QSTtcclxuXHRcdFx0Y3NzM2RPYmoucG9zaXRpb24ueCA9IC0gcmFkaXVzICogTWF0aC5zaW4oIHBoaSApO1xyXG5cdFx0XHRjc3MzZE9iai5wb3NpdGlvbi55ID0gLSAoIGhpZHggKiA4ICkgKyAyMDA7XHJcblx0XHRcdGNzczNkT2JqLnBvc2l0aW9uLnogPSByYWRpdXMgKiBNYXRoLmNvcyggcGhpICk7XHJcblxyXG5cdFx0XHR2ZWN0b3Iuc2V0KCAtY3NzM2RPYmoucG9zaXRpb24ueCAqIDIsIGNzczNkT2JqLnBvc2l0aW9uLnksIC1jc3MzZE9iai5wb3NpdGlvbi56ICogMiApO1xyXG5cblx0XHRcdGNzczNkT2JqLmxvb2tBdCggdmVjdG9yICk7XHJcblx0XHRcdGFsbFBvc3RlcnMuYWRkKCBjc3MzZE9iaiApO1xuXG5cdFx0fVxuXG5cdFx0bG9nLmRlYnVnKCAnaW5mbycsICdjdXJyIHBvc3RlcnM6JywgYWxsUG9zdGVycy5jaGlsZHJlbi5sZW5ndGggKTtcclxuXHJcblx0fVxuXG5cdGZ1bmN0aW9uIGNsZWFyQWxsKCkge1xyXG5cdFx0YWxsUG9zdGVycy5jaGlsZHJlbi5mb3JFYWNoKCBmdW5jdGlvbiAoIHBvc3RlciApIHtcclxuXHRcdFx0cG9zdGVyLmRpc3Bvc2VFbGVtZW50KCk7XHJcblx0XHRcdHBvc3Rlci5zY29wZS4kZGVzdHJveSgpO1xyXG5cdFx0fSApO1xyXG5cdFx0YWxsUG9zdGVycy5jaGlsZHJlbi5sZW5ndGggPSAwOyAvLyBjbGVhciBpdGVtc1xyXG5cdH1cclxuXG5cdHJldHVybiB7XG5cdFx0bWFrZUhlbGl4UG9zdGVycyxcblx0XHRjbGVhckFsbFxuXHR9O1xuXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJHN0YXRlJywgJ2NvbGxlY3Rpb25Nb2RhbFNlcnZpY2UnLCBmdW5jdGlvbiAoICRzdGF0ZSwgY29sbGVjdGlvbk1vZGFsU2VydmljZSApIHtcclxuXG5cdGZ1bmN0aW9uIGN0cmwoICRzY29wZSwgJGVsZW1lbnQgKSB7XG5cclxuXHRcdC8vICRzY29wZS5tb3ZpZUl0ZW0gb2JqIGlzIHBhc3NlZCB0aHJ1IGlzb2xhdGVkU2NvcGUgdmlhIGNvbXBpbGVkIGRpcmVjdGl2ZSBpbiBoZWxpeC5mYWMuanNcclxuXHRcdHZhciBpbWcgPSBuZXcgSW1hZ2UoKTtcclxuXHRcdHZhciBpbWdVcmwgPSAnaHR0cDovL2ltYWdlLnRtZGIub3JnL3QvcC93MTU0LycgKyAkc2NvcGUubW92aWVJdGVtLnBvc3Rlcl9wYXRoO1xyXG5cdFx0aW1nLm9ubG9hZCA9IGZ1bmN0aW9uICgpIHtcclxuXHJcblx0XHRcdC8vIHRvZG8gbW92ZSBjc3MgaW50byBzYXNzLCB1c2UgY2xhc3MgaW5zdGVhZFxyXG5cdFx0XHQkZWxlbWVudC5jc3MoIHtcclxuXHRcdFx0XHQnd2lkdGgnOiAnMTUwcHgnLFxyXG5cdFx0XHRcdCdoZWlnaHQnOiAnMjMwcHgnLFxyXG5cdFx0XHRcdCdiYWNrZ3JvdW5kLXJlcGVhdCc6ICduby1yZXBlYXQnLFxyXG5cdFx0XHRcdCdiYWNrZ3JvdW5kLXNpemUnOiAnMTUwcHggMjMwcHgnLFxyXG5cdFx0XHRcdCdiYWNrZ3JvdW5kLWltYWdlJzogJ3VybCgnICsgaW1nVXJsICsgJyknLFxyXG5cdFx0XHRcdCdkaXNwbGF5JzogJ25vbmUnIC8vIHJlcXVpcmVkIGZvciBmYWRlSW4gYW5pbWF0aW9uXHJcblx0XHRcdH0gKTtcclxuXHRcdFx0JGVsZW1lbnQuZmFkZUluKCAxNTAwICk7XHJcblxyXG5cdFx0fTtcclxuXHRcdGltZy5zcmMgPSBpbWdVcmw7XHJcblxuXHRcdCRlbGVtZW50Lm9uKCAnY2xpY2snLCBmdW5jdGlvbiAoIGV2dCApIHtcclxuXHRcdFx0JHN0YXRlLmdvKCAnbW92aWVEZXRhaWwnLCB7IG1vdmllSWQ6ICRzY29wZS5tb3ZpZUl0ZW0uaWQgfSApO1xyXG5cdFx0XHRjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLnNldEFjdGl2ZUl0ZW0oICRzY29wZS5tb3ZpZUl0ZW0gKTtcclxuXHRcdH0gKTtcblxuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRyZXN0cmljdDogJ0UnLFxuXHRcdHJlcGxhY2U6IHRydWUsXG5cdFx0Y29udHJvbGxlcjogY3RybCxcblx0XHR0ZW1wbGF0ZTogJzxkaXYgY2xhc3M9XCJwb3N0ZXJFbGVtXCI+PC9kaXY+J1xuXHR9O1xuXG59IF07XHJcbiIsImFuZ3VsYXIubW9kdWxlKCAnYXBwJywgW1xuXHQndWkucm91dGVyJyxcblx0J25nQW5pbWF0ZSdcbl0gKVxuLmNvbnN0YW50KCAnRU5EUE9JTlRfVVJJJywgJ2h0dHA6Ly9sb2NhbGhvc3Q6ODAwMS8nIClcbi5jb25zdGFudCggJ1RNREJfQVBJJywge1xuXHRrZXk6ICczNzRjMDM0MmE2NDA2ZGZlMGFlYjNkZTJlYTA0MmM1OScsXG5cdHVybDogJ2h0dHA6Ly9hcGkudGhlbW92aWVkYi5vcmcvMy8nXG59IClcblxuLnByb3ZpZGVyKCAnbG9nJywgcmVxdWlyZSggJy4vZGVidWcvbG9nLnB2LmpzJyApIClcblxuLmZhY3RvcnkoICd1dGlsJywgcmVxdWlyZSggJy4vdXRpbC5qcycgKSApXG4uY29udHJvbGxlciggJ21haW5DdHJsJywgcmVxdWlyZSggJy4vbWFpbi5jdHJsLmpzJyApIClcbi5mYWN0b3J5KCAnVE1EYicsIHJlcXVpcmUoICcuL1RNRGIuZmFjLmpzJyApIClcbi5mYWN0b3J5KCAnRVZUJywgcmVxdWlyZSggJy4vZXZlbnRzLmZhYy5qcycgKSApXG4uY29udHJvbGxlciggJ21vdmllRGV0YWlsQ3RybCcsIHJlcXVpcmUoICcuL21vdmllRGV0YWlsLmN0cmwuanMnICkgKVxuLmRpcmVjdGl2ZSggJ2Rpc3BsYXknLCByZXF1aXJlKCAnLi9oZWxpeC9kaXNwbGF5LmRpci5qcycgKSApXG4uZmFjdG9yeSggJ0VOR0lORScsIHJlcXVpcmUoICcuL2hlbGl4L2VuZ2luZS5mYWMuanMnICkgKVxuLmZhY3RvcnkoICdoZWxpeCcsIHJlcXVpcmUoICcuL2hlbGl4L2hlbGl4LmZhYy5qcycgKSApXG4uZGlyZWN0aXZlKCAncG9zdGVyJywgcmVxdWlyZSggJy4vaGVsaXgvcG9zdGVyLmRpci5qcycgKSApXG5cbi5jb250cm9sbGVyKCAnc2lnbnVwQ3RybCcsIHJlcXVpcmUoICcuL2F1dGgvc2lnbnVwLmN0cmwuanMnICkgKVxuLmNvbnRyb2xsZXIoICdzaWduaW5DdHJsJywgcmVxdWlyZSggJy4vYXV0aC9zaWduaW4uY3RybC5qcycgKSApXG4uY29udHJvbGxlciggJ3NpZ25vdXRDdHJsJywgcmVxdWlyZSggJy4vYXV0aC9zaWdub3V0LmN0cmwuanMnICkgKVxuXG4uZmFjdG9yeSggJ2F1dGgnLCByZXF1aXJlKCAnLi9hdXRoL2F1dGguZmFjLmpzJyApIClcbi5mYWN0b3J5KCAnYXV0aFRva2VuJywgcmVxdWlyZSggJy4vYXV0aC9hdXRoVG9rZW4uZmFjLmpzJyApIClcbi5mYWN0b3J5KCAnYXV0aEludGVyY2VwdG9yJywgcmVxdWlyZSggJy4vYXV0aC9hdXRoSW50ZXJjZXB0b3IuZmFjLmpzJyApIClcblxuLmNvbnRyb2xsZXIoICdtb3ZpZUNvbGxlY3Rpb25DdHJsJywgcmVxdWlyZSggJy4vYXV0aC9tb3ZpZUNvbGxlY3Rpb24uY3RybC5qcycgKSApXG4uZmFjdG9yeSggJ21vdmllQ29sbGVjdGlvbicsIHJlcXVpcmUoICcuL21vdmllQ29sbGVjdGlvbi5mYWMuanMnICkgKVxuLmRpcmVjdGl2ZSggJ2NvbGxlY3Rpb25Nb2RhbCcsIHJlcXVpcmUoICcuL2NvbGxlY3Rpb25Nb2RhbC5kaXIuanMnICkgKVxuLmZhY3RvcnkoICdjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlJywgcmVxdWlyZSggJy4vY29sbGVjdGlvbk1vZGFsU2VydmljZS5mYWMuanMnICkgKVxuXG4uY29uZmlnKCBbICckc3RhdGVQcm92aWRlcicsICckdXJsUm91dGVyUHJvdmlkZXInLCAnJGh0dHBQcm92aWRlcicsXG5mdW5jdGlvbiAoICRzdGF0ZVByb3ZpZGVyLCAkdXJsUm91dGVyUHJvdmlkZXIsICRodHRwUHJvdmlkZXIgKSB7XG5cblx0JHVybFJvdXRlclByb3ZpZGVyLm90aGVyd2lzZSggJy8nICk7XG5cblx0JHN0YXRlUHJvdmlkZXJcblx0XHQuc3RhdGUoICdob21lJywge1xuXHRcdFx0dXJsOiAnLycsXG5cdFx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvaG9tZS5odG1sJ1xuXHRcdH0gKVxuXHRcdC5zdGF0ZSggJ21vdmllRGV0YWlsJywge1xuXHRcdFx0dXJsOiAnL21vdmllLzptb3ZpZUlkJyxcblx0XHRcdHRlbXBsYXRlVXJsOiAnLi90ZW1wbGF0ZS9tb3ZpZS5odG1sJyxcblx0XHRcdGNvbnRyb2xsZXI6ICdtb3ZpZURldGFpbEN0cmwnLFxuXHRcdFx0Y29udHJvbGxlckFzOiAnbWQnLFxuXHRcdFx0cmVzb2x2ZToge1xuXHRcdFx0XHRtb3ZpZUl0ZW06IFsgJyRzdGF0ZVBhcmFtcycsICdUTURiJywgZnVuY3Rpb24gKCAkc3RhdGVQYXJhbXMsIFRNRGIgKSB7XG5cdFx0XHRcdFx0cmV0dXJuIFRNRGIuc2VhcmNoQnlJZCggJHN0YXRlUGFyYW1zLm1vdmllSWQgKTtcblx0XHRcdFx0fV1cblx0XHRcdH1cblx0XHR9IClcblx0XHQuc3RhdGUoICdzaWdudXAnLCB7XG5cdFx0XHR1cmw6ICcvc2lnbnVwJyxcblx0XHRcdHRlbXBsYXRlVXJsOiAnLi90ZW1wbGF0ZS9zaWdudXAuaHRtbCcsXG5cdFx0XHRjb250cm9sbGVyOiAnc2lnbnVwQ3RybCcsXG5cdFx0XHRjb250cm9sbGVyQXM6ICdzaWdudXAnXG5cdFx0fSApXG5cdFx0LnN0YXRlKCAnc2lnbmluJywge1xuXHRcdFx0dXJsOiAnL3NpZ25pbicsXG5cdFx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvc2lnbmluLmh0bWwnLFxuXHRcdFx0Y29udHJvbGxlcjogJ3NpZ25pbkN0cmwnLFxuXHRcdFx0Y29udHJvbGxlckFzOiAnc2lnbmluJ1xuXHRcdH0gKVxuXHRcdC5zdGF0ZSggJ3NpZ25vdXQnLCB7XG5cdFx0XHR1cmw6ICcvc2lnbm91dCcsXG5cdFx0XHRjb250cm9sbGVyOiAnc2lnbm91dEN0cmwnXG5cdFx0fSApXG5cdFx0LnN0YXRlKCdjb2xsZWN0aW9uJywge1xuXHRcdFx0dXJsOiAnL2NvbGxlY3Rpb24nLFxuXHRcdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL2NvbGxlY3Rpb24uaHRtbCcsXG5cdFx0XHRjb250cm9sbGVyOiAnbW92aWVDb2xsZWN0aW9uQ3RybCcsXG5cdFx0XHRjb250cm9sbGVyQXM6ICdtYycsXG5cdFx0XHRyZXNvbHZlOiB7XG5cdFx0XHRcdGF1dGhvcml6ZTogWyAnYXV0aCcsIGZ1bmN0aW9uICggYXV0aCApIHtcblx0XHRcdFx0XHRyZXR1cm4gYXV0aC5hdXRob3JpemUoKTtcblx0XHRcdFx0fSBdLFxuXHRcdFx0XHRyZXNvbHZlZENvbGxlY3Rpb246IFsgJ21vdmllQ29sbGVjdGlvbicsIGZ1bmN0aW9uICggbW92aWVDb2xsZWN0aW9uICkge1xuXHRcdFx0XHRcdHJldHVybiBtb3ZpZUNvbGxlY3Rpb24ucmVzb2x2ZUNvbGxlY3Rpb24oKTtcblx0XHRcdFx0fSBdXG5cdFx0XHR9XG5cdFx0fSlcblx0O1xuXG5cdCRodHRwUHJvdmlkZXIuaW50ZXJjZXB0b3JzLnB1c2goICdhdXRoSW50ZXJjZXB0b3InICk7XG5cbn0gXSApXG4ucnVuKCBbICdsb2cnLCAnJHJvb3RTY29wZScsICckc3RhdGUnLCAnYXV0aCcsICdtb3ZpZUNvbGxlY3Rpb24nLCBmdW5jdGlvbiAoIGxvZywgJHJvb3RTY29wZSwgJHN0YXRlLCBhdXRoLCBtb3ZpZUNvbGxlY3Rpb24gKSB7XG5cblx0Ly8gdG9kbyBhdXRob3JpemUgdXNlciBldmVyeSBiZWdpbm5pbmcgb2Ygc2Vzc2lvblxuXHQvLyB0b2RvIGRvbnQgYXV0b3JpemUgdHdpY2Vcblx0YXV0aC5hdXRob3JpemUoIHRydWUgKTtcblxuXHRtb3ZpZUNvbGxlY3Rpb24ucmVzb2x2ZUNvbGxlY3Rpb24oKTtcblxuXHQkcm9vdFNjb3BlLiRvbiggJyRzdGF0ZUNoYW5nZUVycm9yJywgZnVuY3Rpb24gKCBldmVudCwgdG9TdGF0ZSwgdG9QYXJhbXMsIGZyb21TdGF0ZSwgZnJvbVBhcmFtcywgZXJyb3IgKSB7XG5cblx0XHRldmVudC5wcmV2ZW50RGVmYXVsdCgpOyAvLyBwcmV2ZW50IHRyYW5zaXRpb25cblx0XHRsb2cuZGVidWcoICd3YXJuJywgZXJyb3IgKTtcblx0XHRpZiAoIGVycm9yICkge1xuXHRcdFx0JHN0YXRlLmdvKCAnc2lnbmluJyApO1xuXHRcdH1cblxuXHR9ICk7XG5cbn0gXSApXG4uY29uZmlnKCBbICdsb2dQcm92aWRlcicsICckaHR0cFByb3ZpZGVyJywgZnVuY3Rpb24gKCBsb2dQcm92aWRlciwgJGh0dHBQcm92aWRlciApIHtcblxuXHRsb2dQcm92aWRlci5lbmFibGVEZWJ1ZygpO1xuXHRsb2dQcm92aWRlci5lbmFibGVEZWJ1Z05hbWVzcGFjZSggJ2luZm8nLCAnZXJyJywgJ2F1dGgnICk7IC8vIGN0cmxcblxuXHQkaHR0cFByb3ZpZGVyLnVzZUxlZ2FjeVByb21pc2VFeHRlbnNpb25zKCBmYWxzZSApO1xuXG59IF0gKVxuO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJ1RNRGInLCAnRVZUJywgJ2hlbGl4JywgJ0VOR0lORScsICdhdXRoJyxcbmZ1bmN0aW9uICggbG9nLCAkc2NvcGUsIFRNRGIsIEVWVCwgaGVsaXgsIEVOR0lORSwgYXV0aCApIHtcblxuXHR2YXIgdm0gPSB0aGlzO1xuXHR2bS5hdXRoID0gYXV0aDtcblx0dm0uc2VhcmNoID0ge1xuXHRcdHF1ZXJ5OiAnJyxcblx0fTtcblx0dm0ubW92aWVJdGVtcyA9IG51bGw7XG5cblx0JHNjb3BlLiR3YXRjaCggVE1EYi5nZXRSZXMsIGZ1bmN0aW9uICggbW92SXRlbXMgKSB7XG5cblx0XHR2bS5tb3ZpZUl0ZW1zID0gbW92SXRlbXM7XG5cdFx0aGVsaXgubWFrZUhlbGl4UG9zdGVycyggbW92SXRlbXMuc2xpY2UoIFRNRGIucHJldlJlc3VsdExlbiApLCBUTURiLnByZXZSZXN1bHRMZW4gKTtcblxuXHR9LCB0cnVlICk7XG5cblx0dmFyIHByZXZRdWVyeSA9ICcnO1xuXHR2bS5zZWFyY2ggPSBmdW5jdGlvbiAoKSB7XG5cdFx0aWYgKCB2bS5zZWFyY2gucXVlcnkgPT09ICcnICkgcmV0dXJuO1xuXHRcdGlmICggcHJldlF1ZXJ5ICE9PSB2bS5zZWFyY2gucXVlcnkgKSB7XG5cdFx0XHRwcmV2UXVlcnkgPSB2bS5zZWFyY2gucXVlcnk7XG5cdFx0XHRUTURiLmNsZWFyU2VhcmNoKCk7XG5cdFx0XHRoZWxpeC5jbGVhckFsbCgpO1xuXHRcdFx0RU5HSU5FLnJlc2V0Q2FtZXJhKCk7XG5cdFx0fVxuXHRcdFRNRGIuc2VhcmNoQnlUaXRsZSggdm0uc2VhcmNoICk7XG5cdH07XG5cblx0Ly8gREVCVUdcblx0d2luZG93LlNDT1BFID0gJHNjb3BlO1xuXHR2bS5UTURiID0gVE1EYjtcblx0dm0uaGVsaXggPSBoZWxpeDtcblx0dm0uRU5HSU5FID0gRU5HSU5FO1xuXG5cdEVWVC5FT1AubGlzdGVuKCBmdW5jdGlvbiAoKSB7XG5cdFx0bG9nLmRlYnVnKCAnaW5mbycsICdyZWNpZXZlZCBFT1AgZXZlbnQhJyApO1xuXHR9ICk7XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJ0VORFBPSU5UX1VSSScsICckaHR0cCcsICckcScsIGZ1bmN0aW9uICggbG9nLCBFTkRQT0lOVF9VUkksICRodHRwLCAkcSApIHtcclxuXHJcblx0dmFyIERCX0VORFBPSU5UID0gRU5EUE9JTlRfVVJJICsgJ2NvbGxlY3Rpb24nO1xyXG5cdHZhciBjb2xsZWN0aW9uID0gbnVsbDtcclxuXHJcblx0ZnVuY3Rpb24gY3JlYXRlKCBuYW1lICkge1xyXG5cdFx0Ly8gY29sbGVjdGlvbiBuZWVkcyB0byBiZSByZXNvbHZlZCBmaXJzdFxyXG5cdFx0Ly8gdG9kbyBjaGVjayBpZiBjb2xsZWN0aW9uIGlzIGFscmVkeSBleGlzdHNcclxuXHRcdGNvbGxlY3Rpb24ucHVzaCggeyBjb2xsZWN0aW9uTmFtZTogbmFtZSwgbW92aWVzOiBbXSB9ICk7XHJcblx0XHRwdXQoKTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIGlzRW1wdHkoKSB7XHJcblx0XHRyZXR1cm4gY29sbGVjdGlvbi5sZW5ndGggPT09IDA7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiByZXNvbHZlQ29sbGVjdGlvbigpIHtcclxuXHJcblx0XHR2YXIgZGVmZXJyZWQgPSAkcS5kZWZlcigpO1xyXG5cclxuXHRcdGlmICggY29sbGVjdGlvbiAhPT0gbnVsbCApIHtcclxuXHRcdFx0ZGVmZXJyZWQucmVzb2x2ZSggY29sbGVjdGlvbiApO1xyXG5cdFx0fSBlbHNlIHtcclxuXHRcdFx0JGh0dHAuZ2V0KCBEQl9FTkRQT0lOVCwgeyByZXF1aXJlQXV0aDogdHJ1ZSB9IClcclxuXHRcdFx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblx0XHRcdFx0XHRsb2cuZGVidWcoICdpbmZvJywgJ2NvbGxlY3Rpb24ucmVzb2x2ZUNvbGxlY3Rpb24oKTonLCByZXMgKTtcclxuXHRcdFx0XHRcdGlmICggcmVzLmRhdGEgKSB7XHJcblx0XHRcdFx0XHRcdGNvbGxlY3Rpb24gPSByZXMuZGF0YTtcclxuXHRcdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRcdGNvbGxlY3Rpb24gPSBbXTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdGRlZmVycmVkLnJlc29sdmUoIHRydWUgKTtcclxuXHRcdFx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ3dhcm4nLCAnY29sbGVjdGlvbi5yZXNvbHZlQ29sbGVjdGlvbigpOicsIGVyciApO1xyXG5cdFx0XHRcdFx0ZGVmZXJyZWQucmVqZWN0KCBlcnIgKTtcclxuXHRcdFx0XHR9ICk7XHJcblx0XHR9XHJcblxyXG5cdFx0cmV0dXJuIGRlZmVycmVkLnByb21pc2U7XHJcblxyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gaGFzSXRlbSggaXRlbUlkLCBzb21lQ29sbGVjdGlvbiApIHtcclxuXHRcdGZvciAoIHZhciBpID0gMDsgaSA8IGNvbGxlY3Rpb24ubGVuZ3RoOyBpICsrICkge1xyXG5cdFx0XHRpZiAoIGNvbGxlY3Rpb25baV0uY29sbGVjdGlvbk5hbWUgPT09IHNvbWVDb2xsZWN0aW9uICkge1xyXG5cdFx0XHRcdGZvciAoIHZhciBrID0gMDsgayA8IGNvbGxlY3Rpb25baV0ubW92aWVzLmxlbmd0aDsgayArKyApIHtcclxuXHRcdFx0XHRcdGlmICggY29sbGVjdGlvbltpXS5tb3ZpZXNba10gPT09IGl0ZW1JZCApIHtcclxuXHRcdFx0XHRcdFx0cmV0dXJuIHRydWU7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHR9XHJcblx0XHRyZXR1cm4gZmFsc2U7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBwdXQoKSB7XHJcblx0XHQkaHR0cC5wdXQoIERCX0VORFBPSU5ULCBjb2xsZWN0aW9uLCB7IHJlcXVpcmVBdXRoOiB0cnVlIH0gKVxyXG5cdFx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblx0XHRcdFx0bG9nLmRlYnVnKCAnaW5mbycsICdjb2xsZWN0aW9uLnB1dCgpOicsIHJlcyApO1xyXG5cdFx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0XHRsb2cuZGVidWcoICdlcnInLCAnY29sbGVjdGlvbi5wdXQoKTonLCBlcnIgKTtcclxuXHRcdFx0fSApO1xyXG5cdH1cclxuXHJcblx0LyogY29sbGVjdGlvbnMgbmVlZHMgdG8gYmUgcmVzb2x2ZWQgZmlyc3RcclxuXHR1cGRhdGUgbG9jYWwgY29sbGVjdGlvblxyXG5cdCovXHJcblx0ZnVuY3Rpb24gcHVzaCggaXRlbUlkLCB0b0NvbGxlY3Rpb24gKSB7XHJcblx0XHRpZiAoIGhhc0l0ZW0oIGl0ZW1JZCwgdG9Db2xsZWN0aW9uICkgKSB7XHJcblx0XHRcdHJldHVybiBmYWxzZTtcclxuXHRcdH1cclxuXHRcdGZvciAoIHZhciBpID0gMDsgaSA8IGNvbGxlY3Rpb24ubGVuZ3RoOyBpICsrICkge1xyXG5cdFx0XHRpZiAoIGNvbGxlY3Rpb25baV0uY29sbGVjdGlvbk5hbWUgPT09IHRvQ29sbGVjdGlvbiApIHtcclxuXHRcdFx0XHRjb2xsZWN0aW9uW2ldLm1vdmllcy5wdXNoKCBpdGVtSWQgKTtcclxuXHRcdFx0XHRwdXQoKTtcclxuXHRcdFx0XHRyZXR1cm4gdHJ1ZTtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cdFx0cmV0dXJuIGZhbHNlO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gcmVtb3ZlKCBpdGVtSWQsIGluQ29sbGVjdGlvbiApIHtcclxuXHRcdGZvciAoIHZhciBpID0gMDsgaSA8IGNvbGxlY3Rpb24ubGVuZ3RoOyBpICsrICkge1xyXG5cdFx0XHRpZiAoIGNvbGxlY3Rpb25baV0uY29sbGVjdGlvbk5hbWUgPT09IGluQ29sbGVjdGlvbiApIHtcclxuXHRcdFx0XHRmb3IgKCB2YXIgayA9IDA7IGsgPCBjb2xsZWN0aW9uW2ldLm1vdmllcy5sZW5ndGg7IGsgKysgKSB7XHJcblx0XHRcdFx0XHRpZiAoIGNvbGxlY3Rpb25baV0ubW92aWVzW2tdID09PSBpdGVtSWQgKSB7XHJcblx0XHRcdFx0XHRcdHZhciByZW1vdmVkID0gY29sbGVjdGlvbltpXS5tb3ZpZXMuc3BsaWNlKCBrLCAxICkubGVuZ3RoO1xyXG5cdFx0XHRcdFx0XHRwdXQoKTtcclxuXHRcdFx0XHRcdFx0cmV0dXJuIHJlbW92ZWQgIT09IDA7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHR9XHJcblx0XHRyZXR1cm4gZmFsc2U7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiByZW1vdmVDb2xsZWN0aW9uKCBjb2xsZWN0aW9uTmFtZSApIHtcclxuXHRcdGZvciAoIHZhciBpID0gMDsgaSA8IGNvbGxlY3Rpb24ubGVuZ3RoOyBpICsrICkge1xyXG5cdFx0XHRpZiAoIGNvbGxlY3Rpb25baV0uY29sbGVjdGlvbk5hbWUgPT09IGNvbGxlY3Rpb25OYW1lICkge1xyXG5cdFx0XHRcdHZhciByZW1vdmVkID0gY29sbGVjdGlvbi5zcGxpY2UoIGksIDEgKS5sZW5ndGg7XHJcblx0XHRcdFx0cHV0KCk7XHJcblx0XHRcdFx0cmV0dXJuIHJlbW92ZWQgIT09IDA7XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHRcdHJldHVybiBmYWxzZTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIHN5bmMoKSB7XHJcblx0XHQvLyBzeW5jIGxvY2FsIGNvbGVsY3Rpb24gdy8gREJcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIGdldENvbGxlY3Rpb24oKSB7XHJcblx0XHRyZXR1cm4gY29sbGVjdGlvbjtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIF9jbGVhcigpIHtcclxuXHRcdGNvbGxlY3Rpb24gPSBudWxsO1xyXG5cdFx0bG9nLmRlYnVnKCAnaW5mbycsICdsb2NhbCBjb2xsZWN0aW9uIGNsZWFyZWQuJyApO1xyXG5cdH1cclxuXHJcblx0cmV0dXJuIHtcclxuXHRcdGdldENvbGxlY3Rpb24sXHJcblx0XHRjcmVhdGUsXHJcblx0XHRwdXNoLFxyXG5cdFx0cHV0LFxyXG5cdFx0cmVtb3ZlLFxyXG5cdFx0cmVtb3ZlQ29sbGVjdGlvbixcclxuXHRcdHN5bmMsXHJcblx0XHRfY2xlYXIsXHJcblx0XHRyZXNvbHZlQ29sbGVjdGlvbixcclxuXHRcdGhhc0l0ZW0sXHJcblx0XHRpc0VtcHR5XHJcblx0fTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJ1RNRGInLCAnJGNhY2hlRmFjdG9yeScsICdtb3ZpZUl0ZW0nLCAnY29sbGVjdGlvbk1vZGFsU2VydmljZScsXHJcbmZ1bmN0aW9uKCBsb2csICRzY29wZSwgVE1EYiwgJGNhY2hlRmFjdG9yeSwgbW92aWVJdGVtLCBjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlICkge1xyXG5cclxuXHR2YXIgdm0gPSB0aGlzO1xyXG5cdHZtLm1vdmllSXRlbSA9IG1vdmllSXRlbTsgLy8gbW92aWVJdGVtIGluamVjdGVkIHZpYSBzdGF0ZSByZXNvbHZlXHJcblx0bG9nLmRlYnVnKCAnY3RybCcsICdtb3ZpZURldGFpbCBjdHJsIHJlc29sdmVkOicsIHZtLm1vdmllSXRlbSApO1xyXG5cclxuXHRtb3ZpZUl0ZW0uZnVsbFRpdGxlID0gbW92aWVJdGVtLnRpdGxlO1xyXG5cdGlmICggbW92aWVJdGVtLnRpdGxlICE9PSBtb3ZpZUl0ZW0ub3JpZ2luYWxfdGl0bGUgKSB7XHJcblx0XHRtb3ZpZUl0ZW0uZnVsbFRpdGxlID0gbW92aWVJdGVtLnRpdGxlICsgJyAoJyArIG1vdmllSXRlbS5vcmlnaW5hbF90aXRsZSArICcpJztcclxuXHR9XHJcblxyXG5cdGlmICggbW92aWVJdGVtLmJhY2tkcm9wX3BhdGggKSB7XHJcblx0XHR2YXIgaW1nVXJsID0gJ2h0dHA6Ly9pbWFnZS50bWRiLm9yZy90L3Avb3JpZ2luYWwnICsgbW92aWVJdGVtLmJhY2tkcm9wX3BhdGg7XHJcblx0XHQkKCAnLmJhY2tkcm9wJyApLmNzcygge1xyXG5cdFx0XHQnYmFja2dyb3VuZC1pbWFnZSc6ICd1cmwoJyArIGltZ1VybCArICcpJ1xyXG5cdFx0fSApO1xyXG5cdH1cclxuXHJcblx0dm0ub3BlbkNvbGxlY3Rpb25Nb2RhbCA9IGZ1bmN0aW9uICgpIHtcclxuXHRcdGNvbGxlY3Rpb25Nb2RhbFNlcnZpY2Uuc2V0QWN0aXZlSXRlbSggbW92aWVJdGVtICk7XHJcblx0XHRjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLm9wZW4oKTtcclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgZnVuY3Rpb24gKCkge1xyXG5cclxuXHRmdW5jdGlvbiBkZWJvdW5jZSggZnVuYywgd2FpdCwgaW1tZWRpYXRlICkge1xyXG5cdFx0dmFyIF90aGlzID0gdGhpcyxcclxuXHRcdFx0X2FyZ3VtZW50cyA9IGFyZ3VtZW50cztcclxuXHJcblx0XHR2YXIgdGltZW91dDtcclxuXHRcdHJldHVybiBmdW5jdGlvbiAoKSB7XHJcblxyXG5cdFx0XHR2YXIgY29udGV4dCA9IF90aGlzLFxyXG5cdFx0XHRcdGFyZ3MgPSBfYXJndW1lbnRzO1xyXG5cdFx0XHR2YXIgbGF0ZXIgPSBmdW5jdGlvbiBsYXRlcigpIHtcclxuXHJcblx0XHRcdFx0dGltZW91dCA9IG51bGw7XHJcblx0XHRcdFx0aWYgKCAhaW1tZWRpYXRlICkgZnVuYy5hcHBseSggY29udGV4dCwgYXJncyApO1xyXG5cdFx0XHR9O1xyXG5cdFx0XHR2YXIgY2FsbE5vdyA9IGltbWVkaWF0ZSAmJiAhdGltZW91dDtcclxuXHRcdFx0Y2xlYXJUaW1lb3V0KCB0aW1lb3V0ICk7XHJcblx0XHRcdHRpbWVvdXQgPSBzZXRUaW1lb3V0KCBsYXRlciwgd2FpdCApO1xyXG5cdFx0XHRpZiAoIGNhbGxOb3cgKSBmdW5jLmFwcGx5KCBjb250ZXh0LCBhcmdzICk7XHJcblx0XHR9O1xyXG5cdH1cclxuXHJcblx0cmV0dXJuIHtcclxuXHRcdGRlYm91bmNlXHJcblx0fTtcclxuXHJcbn0gXTtcclxuIl19
