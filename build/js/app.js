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
				movieIdCache.put(res.data.id, res.data);
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

		var df_DB = $q.defer();
		var df_Res = $q.defer();

		var cachedItem = movieIdCache.get(id);
		if (cachedItem) {
			log.debug('info', 'searchById => cache:', cachedItem);
			df_Res.resolve(cachedItem);
			return df_Res.promise;
		}

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
					console.log(item.id, item);
					movieIdCache.put(item.id, item);
					// putItemToDB( item );
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
		putItemToDB: putItemToDB,
		movieIdCache: movieIdCache
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

module.exports = ['log', 'TMDb', function (log, TMDb) {

	function ctrl($scope, $attrs, $element) {

		TMDb.searchById(parseInt($scope.movieId)).then(function (res) {

			// log.debug( 'info', 'collectionItemDirective', res );
			var imgUrl = 'http://image.tmdb.org/t/p/w154/' + res.poster_path;
			$element.css({
				'width': '50px',
				'height': '70px',
				'background-repeat': 'no-repeat',
				'background-size': '50px 70px',
				'background-image': 'url(' + imgUrl + ')'
			});
		}, function (err) {
			log.debug('err', 'collectionItemDirective', err);
		});
	}

	return {
		restrict: 'E',
		replace: true,
		scope: { movieId: '@' },
		controller: ctrl,
		controllerAs: 'ci',
		template: '<div></div>'
	};
}];

},{}],10:[function(require,module,exports){
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

},{}],11:[function(require,module,exports){
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

},{}],12:[function(require,module,exports){
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

},{}],13:[function(require,module,exports){
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

},{}],14:[function(require,module,exports){
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

},{}],15:[function(require,module,exports){
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

},{}],16:[function(require,module,exports){
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

},{}],17:[function(require,module,exports){
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

},{}],18:[function(require,module,exports){
'use strict';

angular.module('app', ['ui.router', 'ngAnimate']).constant('ENDPOINT_URI', 'http://localhost:8001/').constant('TMDB_API', {
	key: '374c0342a6406dfe0aeb3de2ea042c59',
	url: 'http://api.themoviedb.org/3/'
}).provider('log', require('./debug/log.pv.js')).factory('util', require('./util.js')).controller('mainCtrl', require('./main.ctrl.js')).factory('TMDb', require('./TMDb.fac.js')).factory('EVT', require('./events.fac.js')).controller('movieDetailCtrl', require('./movieDetail.ctrl.js')).directive('display', require('./helix/display.dir.js')).factory('ENGINE', require('./helix/engine.fac.js')).factory('helix', require('./helix/helix.fac.js')).directive('poster', require('./helix/poster.dir.js')).controller('signupCtrl', require('./auth/signup.ctrl.js')).controller('signinCtrl', require('./auth/signin.ctrl.js')).controller('signoutCtrl', require('./auth/signout.ctrl.js')).factory('auth', require('./auth/auth.fac.js')).factory('authToken', require('./auth/authToken.fac.js')).factory('authInterceptor', require('./auth/authInterceptor.fac.js')).controller('movieCollectionCtrl', require('./auth/movieCollection.ctrl.js')).factory('movieCollection', require('./movieCollection.fac.js')).directive('collectionModal', require('./collectionModal.dir.js')).factory('collectionModalService', require('./collectionModalService.fac.js')).directive('collectionItem', require('./collectionItem.dir.js')).config(['$stateProvider', '$urlRouterProvider', '$httpProvider', function ($stateProvider, $urlRouterProvider, $httpProvider) {

	$urlRouterProvider.otherwise('/');

	$stateProvider.state('helix', {
		url: '/',
		templateUrl: './template/helix.html'
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

},{"./TMDb.fac.js":1,"./auth/auth.fac.js":2,"./auth/authInterceptor.fac.js":3,"./auth/authToken.fac.js":4,"./auth/movieCollection.ctrl.js":5,"./auth/signin.ctrl.js":6,"./auth/signout.ctrl.js":7,"./auth/signup.ctrl.js":8,"./collectionItem.dir.js":9,"./collectionModal.dir.js":10,"./collectionModalService.fac.js":11,"./debug/log.pv.js":12,"./events.fac.js":13,"./helix/display.dir.js":14,"./helix/engine.fac.js":15,"./helix/helix.fac.js":16,"./helix/poster.dir.js":17,"./main.ctrl.js":19,"./movieCollection.fac.js":20,"./movieDetail.ctrl.js":21,"./util.js":22}],19:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', 'TMDb', 'EVT', 'helix', 'ENGINE', 'auth', '$state', function (log, $scope, TMDb, EVT, helix, ENGINE, auth, $state) {

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
		if ($state.current.name !== 'helix') {
			$state.go('helix');
		}
		TMDb.searchByTitle(vm.search);
	};

	// DEBUG
	window.SCOPE = $scope;
	vm.TMDb = TMDb;
	vm.helix = helix;
	vm.ENGINE = ENGINE;
	vm.STATE = $state;

	EVT.EOP.listen(function () {
		log.debug('info', 'recieved EOP event!');
	});
}];

},{}],20:[function(require,module,exports){
'use strict';

module.exports = ['log', 'ENDPOINT_URI', '$http', '$q', function (log, ENDPOINT_URI, $http, $q) {

	var DB_ENDPOINT = ENDPOINT_URI + 'collection';
	var collection = null;

	var fullCollection = null;

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

},{}],21:[function(require,module,exports){
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

},{}],22:[function(require,module,exports){
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

},{}]},{},[18])
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9UTURiLmZhYy5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2F1dGgvYXV0aC5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL2F1dGhJbnRlcmNlcHRvci5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL2F1dGhUb2tlbi5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL21vdmllQ29sbGVjdGlvbi5jdHJsLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvYXV0aC9zaWduaW4uY3RybC5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2F1dGgvc2lnbm91dC5jdHJsLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvYXV0aC9zaWdudXAuY3RybC5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2NvbGxlY3Rpb25JdGVtLmRpci5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2NvbGxlY3Rpb25Nb2RhbC5kaXIuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9jb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLmZhYy5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2RlYnVnL2xvZy5wdi5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2V2ZW50cy5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9oZWxpeC9kaXNwbGF5LmRpci5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2hlbGl4L2VuZ2luZS5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9oZWxpeC9oZWxpeC5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9oZWxpeC9wb3N0ZXIuZGlyLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvaW5kZXguanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9tYWluLmN0cmwuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9tb3ZpZUNvbGxlY3Rpb24uZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvbW92aWVEZXRhaWwuY3RybC5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL3V0aWwuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7OztBQ0FBLE1BQU0sQ0FBQyxPQUFPLEdBQUcsQ0FBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFLElBQUksRUFBRSxjQUFjLEVBQzNGLFVBQVcsR0FBRyxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLGFBQWEsRUFBRSxFQUFFLEVBQUUsWUFBWSxFQUFHOztBQUV2RSxLQUFJLFlBQVksR0FBRyxFQUFFLENBQUM7QUFDdEIsS0FBSSxhQUFhLEdBQUcsQ0FBQyxDQUFDO0FBQ3RCLEtBQUksVUFBVSxHQUFHLENBQUMsQ0FBQyxDQUFDO0FBQ3BCLEtBQUksUUFBUSxHQUFHLENBQUMsQ0FBQzs7QUFFakIsS0FBSSxZQUFZLEdBQUcsYUFBYSxDQUFFLGNBQWMsQ0FBRSxDQUFDOzs7QUFHbkQsS0FBSSxXQUFXLEdBQUcsWUFBWSxHQUFHLFFBQVEsQ0FBQzs7QUFFMUMsVUFBUyxXQUFXLENBQUUsU0FBUyxFQUFHOztBQUVqQyxPQUFLLENBQUMsR0FBRyxDQUFFLFdBQVcsR0FBRyxTQUFTLENBQUMsRUFBRSxFQUFFLFNBQVMsQ0FBRSxDQUNqRCxJQUFJLENBQUUsVUFBVyxHQUFHLEVBQUc7QUFDdkIsTUFBRyxDQUFDLEtBQUssQ0FBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLEdBQUcsQ0FBRSxDQUFDO0dBQ2pDLEVBQUUsVUFBVyxHQUFHLEVBQUc7QUFDbkIsTUFBRyxDQUFDLEtBQUssQ0FBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLEdBQUcsQ0FBRSxDQUFDO0dBQ2hDLENBQUUsQ0FBQztFQUNKOztBQUVELFVBQVMsY0FBYyxDQUFFLEVBQUUsRUFBRztBQUM3QixNQUFJLE9BQU8sR0FBRyxLQUFLLENBQUMsR0FBRyxDQUFFLFdBQVcsR0FBRyxFQUFFLENBQUUsQ0FDMUMsSUFBSSxDQUFFLFVBQVcsR0FBRyxFQUFHO0FBQ3ZCLE1BQUcsQ0FBQyxLQUFLLENBQUUsTUFBTSxFQUFFLG1CQUFtQixFQUFFLEdBQUcsQ0FBQyxJQUFJLENBQUUsQ0FBQztBQUNuRCxPQUFLLEdBQUcsQ0FBQyxJQUFJLEVBQUc7QUFDZixnQkFBWSxDQUFDLEdBQUcsQ0FBRSxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsRUFBRSxHQUFHLENBQUMsSUFBSSxDQUFFLENBQUM7QUFDMUMsV0FBTyxHQUFHLENBQUMsSUFBSSxDQUFDO0lBQ2hCLE1BQU07QUFDTixXQUFPLElBQUksQ0FBQztJQUNaO0dBQ0QsRUFBRSxVQUFVLEdBQUcsRUFBRztBQUNsQixNQUFHLENBQUMsS0FBSyxDQUFFLEtBQUssRUFBRSxtQkFBbUIsRUFBRSxHQUFHLENBQUUsQ0FBQztHQUM3QyxDQUFFLENBQUM7QUFDSixTQUFPLE9BQU8sQ0FBQztFQUNmOztBQUVELFVBQVMsZUFBZSxDQUFFLEVBQUUsRUFBRztBQUM5QixNQUFJLE9BQU8sR0FBRyxLQUFLLENBQUMsR0FBRyxDQUFFLFFBQVEsQ0FBQyxHQUFHLEdBQUcsUUFBUSxHQUFHLEVBQUUsRUFBRTtBQUN0RCxTQUFNLEVBQUUsRUFBRSxPQUFPLEVBQUUsUUFBUSxDQUFDLEdBQUcsRUFBRTtHQUNqQyxDQUFFLENBQUMsSUFBSSxDQUFFLFVBQVcsR0FBRyxFQUFHO0FBQzFCLE1BQUcsQ0FBQyxLQUFLLENBQUUsTUFBTSxFQUFFLG9CQUFvQixFQUFFLEdBQUcsQ0FBQyxJQUFJLENBQUUsQ0FBQztBQUNwRCxlQUFZLENBQUMsR0FBRyxDQUFFLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxFQUFFLEdBQUcsQ0FBQyxJQUFJLENBQUUsQ0FBQztBQUMxQyxjQUFXLENBQUUsR0FBRyxDQUFDLElBQUksQ0FBRSxDQUFDO0FBQ3hCLFVBQU8sR0FBRyxDQUFDLElBQUksQ0FBQztHQUNoQixFQUFFLFVBQVcsR0FBRyxFQUFHO0FBQ25CLE1BQUcsQ0FBQyxLQUFLLENBQUUsS0FBSyxFQUFFLG9CQUFvQixFQUFFLEdBQUcsQ0FBRSxDQUFDO0dBQzlDLENBQUUsQ0FBQztBQUNKLFNBQU8sT0FBTyxDQUFDO0VBQ2Y7O0FBRUQsVUFBUyxVQUFVLENBQUUsRUFBRSxFQUFHOztBQUV6QixNQUFJLEtBQUssR0FBRyxFQUFFLENBQUMsS0FBSyxFQUFFLENBQUM7QUFDdkIsTUFBSSxNQUFNLEdBQUcsRUFBRSxDQUFDLEtBQUssRUFBRSxDQUFDOztBQUV4QixNQUFJLFVBQVUsR0FBRyxZQUFZLENBQUMsR0FBRyxDQUFFLEVBQUUsQ0FBRSxDQUFDO0FBQ3hDLE1BQUssVUFBVSxFQUFHO0FBQ2pCLE1BQUcsQ0FBQyxLQUFLLENBQUUsTUFBTSxFQUFFLHNCQUFzQixFQUFFLFVBQVUsQ0FBRSxDQUFDO0FBQ3hELFNBQU0sQ0FBQyxPQUFPLENBQUUsVUFBVSxDQUFFLENBQUM7QUFDN0IsVUFBTyxNQUFNLENBQUMsT0FBTyxDQUFDO0dBQ3RCOztBQUVELGdCQUFjLENBQUUsRUFBRSxDQUFFLENBQUMsSUFBSSxDQUFFLFVBQVcsR0FBRyxFQUFHO0FBQzNDLE9BQUssR0FBRyxFQUFHO0FBQ1YsU0FBSyxDQUFDLE9BQU8sQ0FBRSxHQUFHLENBQUUsQ0FBQztJQUNyQixNQUFNO0FBQ04sU0FBSyxDQUFDLE1BQU0sQ0FBRSxXQUFXLENBQUUsQ0FBQztJQUM1QjtHQUNELEVBQUUsVUFBVyxHQUFHLEVBQUc7QUFDbEIsUUFBSyxDQUFDLE1BQU0sQ0FBRSxHQUFHLENBQUUsQ0FBQztHQUNyQixDQUFFLENBQUM7O0FBRUosT0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUUsVUFBVyxNQUFNLEVBQUc7QUFDdkMsU0FBTSxDQUFDLE9BQU8sQ0FBRSxNQUFNLENBQUUsQ0FBQztHQUN6QixFQUFFLFVBQVcsR0FBRyxFQUFHO0FBQ25CLGtCQUFlLENBQUUsRUFBRSxDQUFFLENBQUMsSUFBSSxDQUFFLFVBQVcsT0FBTyxFQUFHO0FBQ2hELFVBQU0sQ0FBQyxPQUFPLENBQUUsT0FBTyxDQUFFLENBQUM7SUFDMUIsRUFBRSxVQUFXLE9BQU8sRUFBRztBQUN2QixVQUFNLENBQUMsTUFBTSxDQUFFLE9BQU8sQ0FBRSxDQUFDO0lBQ3pCLENBQUUsQ0FBQztHQUNKLENBQUUsQ0FBQzs7QUFFSixTQUFPLE1BQU0sQ0FBQyxPQUFPLENBQUM7RUFFdEI7O0FBRUQsVUFBUyxhQUFhLENBQUUsU0FBUyxFQUFHOztBQUVuQyxNQUFLLFFBQVEsR0FBRyxVQUFVLElBQUksVUFBVSxLQUFLLENBQUMsQ0FBQyxFQUFHOztBQUVqRCxNQUFHLENBQUMsR0FBRyxDQUFDLElBQUksRUFBRSxDQUFDO0FBQ2YsVUFBTztHQUNQOztBQUVELE9BQUssQ0FBRTtBQUNOLFNBQU0sRUFBRSxLQUFLO0FBQ2IsUUFBSyxFQUFFLElBQUk7QUFDWCxNQUFHLEVBQUUsUUFBUSxDQUFDLEdBQUcsR0FBRyxjQUFjO0FBQ2xDLFNBQU0sRUFBQztBQUNOLFdBQU8sRUFBRSxRQUFRLENBQUMsR0FBRztBQUNyQixTQUFLLEVBQUUsU0FBUyxDQUFDLEtBQUs7QUFDdEIsUUFBSSxFQUFFLFFBQVE7SUFDZDtHQUNELENBQUUsQ0FBQyxJQUFJLENBQUUsVUFBVyxHQUFHLEVBQUc7O0FBRTFCLGVBQVksR0FBRyxZQUFZLENBQUMsTUFBTSxDQUFFLG1CQUFtQixDQUFFLEdBQUcsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFFLENBQUUsQ0FBQztBQUM5RSxhQUFVLEdBQUcsR0FBRyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUM7QUFDbEMsV0FBUSxFQUFHLENBQUM7QUFDWixnQkFBYSxHQUFHLFlBQVksQ0FBQyxNQUFNLENBQUM7QUFDcEMsTUFBRyxDQUFDLEtBQUssQ0FBRSxNQUFNLEVBQUUsZ0JBQWdCLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQyxJQUFJLENBQUUsQ0FBQzs7O0FBR3JELE1BQUcsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBRSxVQUFXLElBQUksRUFBRzs7QUFFM0MsUUFBSyxDQUFDLFlBQVksQ0FBQyxHQUFHLENBQUUsSUFBSSxDQUFDLEVBQUUsQ0FBRSxFQUFHO0FBQ25DLFlBQU8sQ0FBQyxHQUFHLENBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxJQUFJLENBQUUsQ0FBQztBQUM3QixpQkFBWSxDQUFDLEdBQUcsQ0FBRSxJQUFJLENBQUMsRUFBRSxFQUFFLElBQUksQ0FBRSxDQUFDOztLQUVsQztJQUVELENBQUUsQ0FBQztHQUVKLEVBQUUsVUFBVyxHQUFHLEVBQUc7O0FBRW5CLE1BQUcsQ0FBQyxLQUFLLENBQUUsZ0JBQWdCLEVBQUUsR0FBRyxDQUFFLENBQUM7R0FDbkMsQ0FBRSxDQUFDO0VBRUo7O0FBRUQsVUFBUyxtQkFBbUIsQ0FBRSxPQUFPLEVBQUc7QUFDdkMsU0FBTyxPQUFPLENBQUMsTUFBTSxDQUFFLFVBQVcsSUFBSSxFQUFHO0FBQ3hDLFVBQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUM7R0FDMUIsQ0FBRSxDQUFDO0VBQ0o7O0FBRUQsVUFBUyxNQUFNLEdBQUc7QUFDakIsU0FBTyxZQUFZLENBQUM7RUFDcEI7O0FBRUQsVUFBUyxXQUFXLEdBQUc7O0FBRXRCLGNBQVksQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDO0FBQ3hCLGVBQWEsR0FBRyxDQUFDLENBQUM7QUFDbEIsWUFBVSxHQUFHLENBQUMsQ0FBQyxDQUFDO0FBQ2hCLFVBQVEsR0FBRyxDQUFDLENBQUM7RUFDYjs7QUFFRCxRQUFPO0FBQ04sZUFBYSxFQUFiLGFBQWE7QUFDYixZQUFVLEVBQVYsVUFBVTtBQUNWLGFBQVcsRUFBWCxXQUFXO0FBQ1gsUUFBTSxFQUFOLE1BQU07QUFDTixlQUFhLEVBQWIsYUFBYTtBQUNiLGFBQVcsRUFBWCxXQUFXO0FBQ1gsY0FBWSxFQUFaLFlBQVk7RUFDWixDQUFDO0NBRUYsQ0FBRSxDQUFDOzs7OztBQ2hLSixNQUFNLENBQUMsT0FBTyxHQUFHLENBQUUsS0FBSyxFQUFFLGNBQWMsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLFdBQVcsRUFDcEUsVUFBVyxHQUFHLEVBQUUsWUFBWSxFQUFFLEtBQUssRUFBRSxFQUFFLEVBQUUsU0FBUyxFQUFHOztBQUVuRCxLQUFJLFFBQVEsR0FBRyxJQUFJLENBQUM7QUFDcEIsS0FBSSxpQkFBaUIsR0FBRyxLQUFLLENBQUM7O0FBRTlCLFVBQVMsU0FBUyxDQUFFLEtBQUssRUFBRzs7QUFFM0IsTUFBSSxRQUFRLEdBQUcsRUFBRSxDQUFDLEtBQUssRUFBRSxDQUFDOztBQUUxQixNQUFLLEtBQUssRUFBRyxRQUFRLEdBQUcsSUFBSSxDQUFDOztBQUU3QixNQUFLLFFBQVEsS0FBSyxJQUFJLEVBQUc7O0FBRXhCLFdBQVEsQ0FBQyxPQUFPLENBQUUsSUFBSSxDQUFFLENBQUM7R0FFekIsTUFBTTs7QUFFTixRQUFLLENBQUMsR0FBRyxDQUFFLFlBQVksR0FBRyxNQUFNLEVBQUUsRUFBRSxXQUFXLEVBQUUsSUFBSSxFQUFFLENBQUUsQ0FDdkQsSUFBSSxDQUFFLFVBQVcsR0FBRyxFQUFHOztBQUV2QixPQUFHLENBQUMsS0FBSyxDQUFFLE1BQU0sRUFBRSxtQkFBbUIsRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDLElBQUksQ0FBRSxDQUFDO0FBQ3hELFlBQVEsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDO0FBQ3BCLHFCQUFpQixHQUFHLElBQUksQ0FBQztBQUN6QixZQUFRLENBQUMsT0FBTyxDQUFFLElBQUksQ0FBRSxDQUFDO0lBRXpCLEVBQUUsVUFBVyxHQUFHLEVBQUc7O0FBRW5CLE9BQUcsQ0FBQyxLQUFLLENBQUUsTUFBTSxFQUFFLFdBQVcsRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDLElBQUksQ0FBRSxDQUFDOztBQUVoRCxxQkFBaUIsR0FBRyxJQUFJLENBQUM7QUFDekIsWUFBUSxDQUFDLE1BQU0sQ0FBRSxHQUFHLENBQUUsQ0FBQztJQUV2QixDQUFFLENBQUM7R0FFTDs7QUFFRCxTQUFPLFFBQVEsQ0FBQyxPQUFPLENBQUM7RUFFeEI7O0FBRUQsVUFBUyxXQUFXLEdBQUc7QUFDdEIsV0FBUyxDQUFDLFdBQVcsRUFBRSxDQUFDO0FBQ3hCLFVBQVEsR0FBRyxJQUFJLENBQUM7RUFDaEI7O0FBRUQsVUFBUyxlQUFlLEdBQUc7QUFDMUIsU0FBTyxRQUFRLEtBQUssSUFBSSxDQUFDO0VBQ3pCOztBQUVELFVBQVMsZ0JBQWdCLEdBQUc7QUFDM0IsU0FBTyxpQkFBaUIsQ0FBQztFQUN6Qjs7QUFFRCxRQUFPOztBQUVOLFdBQVMsRUFBVCxTQUFTO0FBQ1QsYUFBVyxFQUFYLFdBQVc7QUFDWCxpQkFBZSxFQUFmLGVBQWU7QUFDZixrQkFBZ0IsRUFBaEIsZ0JBQWdCOztFQUVoQixDQUFDO0NBRUgsQ0FBRSxDQUFDOzs7OztBQy9ESixNQUFNLENBQUMsT0FBTyxHQUFHLENBQUUsV0FBVyxFQUFFLFVBQVcsU0FBUyxFQUFHOztBQUV0RCxVQUFTLE9BQU8sQ0FBRSxNQUFNLEVBQUc7O0FBRTFCLE1BQUssTUFBTSxDQUFDLFdBQVcsRUFBRztBQUN6QixPQUFJLEtBQUssR0FBRyxTQUFTLENBQUMsUUFBUSxFQUFFLENBQUM7QUFDakMsT0FBSyxLQUFLLEVBQUc7Ozs7QUFJWixVQUFNLENBQUMsT0FBTyxDQUFDLGFBQWEsR0FBRyxTQUFTLEdBQUcsS0FBSyxDQUFDO0lBQ2pEO0dBQ0Q7O0FBRUQsU0FBTyxNQUFNLENBQUM7RUFFZDs7QUFFRCxVQUFTLFFBQVEsQ0FBRSxHQUFHLEVBQUc7QUFDeEIsU0FBTyxHQUFHLENBQUM7RUFDWDs7QUFFRCxRQUFPOztBQUVOLFNBQU8sRUFBUCxPQUFPO0FBQ1AsVUFBUSxFQUFSLFFBQVE7O0VBRVIsQ0FBQztDQUVGLENBQUUsQ0FBQzs7Ozs7QUM3QkosTUFBTSxDQUFDLE9BQU8sR0FBRyxDQUFFLEtBQUssRUFBRSxTQUFTLEVBQUUsVUFBVyxHQUFHLEVBQUUsT0FBTyxFQUFHOztBQUU5RCxLQUFJLE9BQU8sR0FBRyxPQUFPLENBQUMsWUFBWSxDQUFDO0FBQ25DLEtBQUksV0FBVyxHQUFHLElBQUksQ0FBQzs7QUFFdkIsVUFBUyxRQUFRLENBQUUsS0FBSyxFQUFHO0FBQzFCLGFBQVcsR0FBRyxLQUFLLENBQUM7QUFDcEIsU0FBTyxDQUFDLE9BQU8sQ0FBRSxLQUFLLEVBQUUsS0FBSyxDQUFFLENBQUM7RUFDaEM7O0FBRUQsVUFBUyxRQUFRLEdBQUc7QUFDbkIsTUFBSyxDQUFDLFdBQVcsRUFBRztBQUNuQixjQUFXLEdBQUcsT0FBTyxDQUFDLE9BQU8sQ0FBRSxLQUFLLENBQUUsQ0FBQztHQUN2QztBQUNELFNBQU8sV0FBVyxDQUFDO0VBQ25COztBQUVELFVBQVMsV0FBVyxHQUFHO0FBQ3RCLGFBQVcsR0FBRyxJQUFJLENBQUM7QUFDbkIsU0FBTyxDQUFDLFVBQVUsQ0FBRSxLQUFLLENBQUUsQ0FBQztBQUM1QixLQUFHLENBQUMsS0FBSyxDQUFFLE1BQU0sRUFBRSxlQUFlLENBQUUsQ0FBQztFQUNyQzs7QUFFRCxVQUFTLFFBQVEsR0FBRztBQUNuQixTQUFPLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FBQztFQUNwQjs7QUFFRCxRQUFPOztBQUVOLFVBQVEsRUFBUixRQUFRO0FBQ1IsVUFBUSxFQUFSLFFBQVE7QUFDUixhQUFXLEVBQVgsV0FBVztBQUNYLFVBQVEsRUFBUixRQUFROztFQUVSLENBQUM7Q0FFRixDQUFFLENBQUM7Ozs7O0FDcENKLE1BQU0sQ0FBQyxPQUFPLEdBQUcsQ0FBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLE1BQU0sRUFBRSxpQkFBaUIsRUFBRSxVQUFXLEdBQUcsRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLGVBQWUsRUFBSTs7QUFFL0csT0FBTSxDQUFDLGVBQWUsR0FBRyxlQUFlLENBQUM7QUFDekMsSUFBRyxDQUFDLEtBQUssQ0FBRSxNQUFNLEVBQUUsZ0JBQWdCLEVBQUUsZUFBZSxDQUFDLGFBQWEsRUFBRSxDQUFFLENBQUM7QUFDdkUsS0FBSSxFQUFFLEdBQUcsSUFBSSxDQUFDO0FBQ2QsR0FBRSxDQUFDLGVBQWUsR0FBRyxlQUFlLENBQUM7Q0FFckMsQ0FBRSxDQUFDOzs7OztBQ1BKLE1BQU0sQ0FBQyxPQUFPLEdBQUcsQ0FBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxjQUFjLEVBQUUsV0FBVyxFQUFFLFFBQVEsRUFDbEYsVUFBVyxHQUFHLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxZQUFZLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBSTs7QUFFakUsS0FBSSxFQUFFLEdBQUcsSUFBSSxDQUFDO0FBQ2QsR0FBRSxDQUFDLElBQUksR0FBRztBQUNULE9BQUssRUFBRSxFQUFFO0FBQ1QsVUFBUSxFQUFFLEVBQUU7RUFDWixDQUFDOztBQUVGLEdBQUUsQ0FBQyxNQUFNLEdBQUcsWUFBVzs7QUFFdEIsTUFBSyxFQUFFLENBQUMsSUFBSSxDQUFDLEtBQUssS0FBSyxFQUFFLElBQUksRUFBRSxDQUFDLElBQUksQ0FBQyxRQUFRLEtBQUssRUFBRSxFQUFHO0FBQ3RELE1BQUcsQ0FBQyxLQUFLLENBQUUsTUFBTSxFQUFFLDRCQUE0QixDQUFFLENBQUM7QUFDbEQsVUFBTztHQUNQOztBQUVELE9BQUssQ0FBQyxJQUFJLENBQUUsWUFBWSxHQUFHLFFBQVEsRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFFLENBQzVDLElBQUksQ0FBRSxVQUFVLEdBQUcsRUFBRztBQUN0QixNQUFHLENBQUMsS0FBSyxDQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLEdBQUcsQ0FBQyxJQUFJLENBQUUsQ0FBQztBQUM3QyxZQUFTLENBQUMsUUFBUSxDQUFFLEdBQUcsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFFLENBQUM7QUFDckMsU0FBTSxDQUFDLEVBQUUsQ0FBRSxZQUFZLENBQUUsQ0FBQztHQUMxQixFQUFFLFVBQVUsR0FBRyxFQUFFLE1BQU0sRUFBRztBQUMxQixNQUFHLENBQUMsS0FBSyxDQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUUsR0FBRyxDQUFFLENBQUM7R0FDbkMsQ0FBRSxDQUFDO0VBRUwsQ0FBQztDQUVGLENBQUUsQ0FBQzs7Ozs7QUMzQkosTUFBTSxDQUFDLE9BQU8sR0FBRyxDQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsaUJBQWlCLEVBQUUsVUFBVyxNQUFNLEVBQUUsSUFBSSxFQUFFLGVBQWUsRUFBSTs7QUFFbkcsS0FBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO0FBQ25CLGdCQUFlLENBQUMsTUFBTSxFQUFFLENBQUM7QUFDekIsT0FBTSxDQUFDLEVBQUUsQ0FBRSxRQUFRLENBQUUsQ0FBQztDQUV0QixDQUFFLENBQUM7Ozs7O0FDTkosTUFBTSxDQUFDLE9BQU8sR0FBRyxDQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLGNBQWMsRUFBRSxXQUFXLEVBQUUsUUFBUSxFQUNsRixVQUFXLEdBQUcsRUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLFlBQVksRUFBRSxTQUFTLEVBQUUsTUFBTSxFQUFHOztBQUUvRCxLQUFJLEVBQUUsR0FBRyxJQUFJLENBQUM7QUFDZCxHQUFFLENBQUMsSUFBSSxHQUFHLEVBQUUsQ0FBQzs7QUFFYixHQUFFLENBQUMsTUFBTSxHQUFHLFlBQVk7O0FBRXZCLE1BQUssRUFBRSxDQUFDLElBQUksQ0FBQyxLQUFLLEtBQUssU0FBUyxJQUFJLEVBQUUsQ0FBQyxJQUFJLENBQUMsUUFBUSxLQUFLLFNBQVMsRUFBRztBQUNwRSxNQUFHLENBQUMsS0FBSyxDQUFFLE1BQU0sRUFBRSw0QkFBNEIsQ0FBRSxDQUFDO0FBQ2xELFVBQU87R0FDUDs7QUFFRCxLQUFHLENBQUMsS0FBSyxDQUFFLE1BQU0sRUFBRSxlQUFlLENBQUUsQ0FBQztBQUNyQyxPQUFLLENBQUMsSUFBSSxDQUFFLFlBQVksR0FBRyxRQUFRLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBRSxDQUM1QyxJQUFJLENBQUUsVUFBVyxHQUFHLEVBQUc7O0FBRXZCLE1BQUcsQ0FBQyxLQUFLLENBQUUsTUFBTSxFQUFFLGFBQWEsQ0FBRSxDQUFDO0FBQ25DLE1BQUcsQ0FBQyxLQUFLLENBQUUsTUFBTSxFQUFFLEdBQUcsQ0FBRSxDQUFDOztBQUV6QixZQUFTLENBQUMsUUFBUSxDQUFFLEdBQUcsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFFLENBQUM7QUFDckMsU0FBTSxDQUFDLEVBQUUsQ0FBRSxZQUFZLENBQUUsQ0FBQztHQUUxQixFQUFFLFVBQVcsR0FBRyxFQUFHOztBQUVuQixNQUFHLENBQUMsS0FBSyxDQUFFLE1BQU0sRUFBRSxHQUFHLENBQUUsQ0FBQztBQUN6QixLQUFFLENBQUMsSUFBSSxDQUFDLFVBQVUsR0FBRyxLQUFLLENBQUM7R0FFM0IsQ0FBRSxDQUFDO0VBRUwsQ0FBQztDQUVILENBQUUsQ0FBQzs7Ozs7QUNoQ0osTUFBTSxDQUFDLE9BQU8sR0FBRyxDQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsVUFBVyxHQUFHLEVBQUUsSUFBSSxFQUFHOztBQUV4RCxVQUFTLElBQUksQ0FBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLFFBQVEsRUFBRzs7QUFFekMsTUFBSSxDQUFDLFVBQVUsQ0FBRSxRQUFRLENBQUUsTUFBTSxDQUFDLE9BQU8sQ0FBRSxDQUFFLENBQzVDLElBQUksQ0FBRSxVQUFXLEdBQUcsRUFBRzs7O0FBR3ZCLE9BQUksTUFBTSxHQUFHLGlDQUFpQyxHQUFHLEdBQUcsQ0FBQyxXQUFXLENBQUM7QUFDakUsV0FBUSxDQUFDLEdBQUcsQ0FBRTtBQUNiLFdBQU8sRUFBRSxNQUFNO0FBQ2YsWUFBUSxFQUFFLE1BQU07QUFDaEIsdUJBQW1CLEVBQUUsV0FBVztBQUNoQyxxQkFBaUIsRUFBRSxXQUFXO0FBQzlCLHNCQUFrQixFQUFFLE1BQU0sR0FBRyxNQUFNLEdBQUcsR0FBRztJQUN6QyxDQUFFLENBQUM7R0FFSixFQUFFLFVBQVcsR0FBRyxFQUFHO0FBQ25CLE1BQUcsQ0FBQyxLQUFLLENBQUUsS0FBSyxFQUFFLHlCQUF5QixFQUFFLEdBQUcsQ0FBRSxDQUFDO0dBQ25ELENBQUUsQ0FBQztFQUVKOztBQUVELFFBQU87QUFDTixVQUFRLEVBQUUsR0FBRztBQUNiLFNBQU8sRUFBRSxJQUFJO0FBQ2IsT0FBSyxFQUFFLEVBQUUsT0FBTyxFQUFFLEdBQUcsRUFBRTtBQUN2QixZQUFVLEVBQUUsSUFBSTtBQUNoQixjQUFZLEVBQUUsSUFBSTtBQUNsQixVQUFRLEVBQUUsYUFBYTtFQUN2QixDQUFDO0NBRUYsQ0FBRSxDQUFDOzs7OztBQ2hDSixNQUFNLENBQUMsT0FBTyxHQUFHLENBQUUsS0FBSyxFQUFFLGlCQUFpQixFQUFFLHdCQUF3QixFQUFFLEtBQUssRUFDNUUsVUFBVyxHQUFHLEVBQUUsZUFBZSxFQUFFLHNCQUFzQixFQUFFLEdBQUcsRUFBRzs7QUFFOUQsV0FBUyxJQUFJLENBQUUsTUFBTSxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUc7O0FBRXpDLFFBQUksRUFBRSxHQUFHLElBQUksQ0FBQztBQUNkLE1BQUUsQ0FBQyxlQUFlLEdBQUcsZUFBZSxDQUFDO0FBQ3JDLE1BQUUsQ0FBQyxzQkFBc0IsR0FBRyxzQkFBc0IsQ0FBQzs7QUFFbkQsTUFBRSxDQUFDLG1CQUFtQixHQUFHLEtBQUssQ0FBQzs7QUFFL0IsTUFBRSxDQUFDLFVBQVUsR0FBRyxZQUFZO0FBQzNCLFFBQUUsQ0FBQyxtQkFBbUIsR0FBRyxJQUFJLENBQUM7S0FDOUIsQ0FBQzs7QUFFRixNQUFFLENBQUMsV0FBVyxHQUFHLFlBQVk7QUFDNUIsUUFBRSxDQUFDLG1CQUFtQixHQUFHLEtBQUssQ0FBQztLQUMvQixDQUFDOztBQUVGLE1BQUUsQ0FBQyxtQkFBbUIsR0FBRyxZQUFZO0FBQ3BDLHFCQUFlLENBQUMsTUFBTSxDQUFFLE1BQU0sQ0FBQyxpQkFBaUIsQ0FBRSxDQUFDO0FBQ25ELFFBQUUsQ0FBQyxXQUFXLEVBQUUsQ0FBQztLQUNqQixDQUFDOztBQUVGLE1BQUUsQ0FBQyxlQUFlLEdBQUcsVUFBVyxPQUFPLEVBQUUsY0FBYyxFQUFHO0FBQ3pELFNBQUcsQ0FBQyxLQUFLLENBQUUsTUFBTSxFQUFFLGtCQUFrQixFQUFFLE9BQU8sRUFBRSxjQUFjLENBQUUsQ0FBQztBQUNqRSxVQUFJLE9BQU8sR0FBRyxlQUFlLENBQUMsSUFBSSxDQUFFLE9BQU8sRUFBRSxjQUFjLENBQUUsQ0FBQztBQUM5RCxTQUFHLENBQUMsS0FBSyxDQUFFLE1BQU0sRUFBRSxzQkFBc0IsRUFBRSxPQUFPLENBQUUsQ0FBQztLQUNyRCxDQUFDOzs7QUFHRixZQUFRLENBQUMsR0FBRyxDQUFFLEVBQUUsVUFBVSxFQUFFLFFBQVEsRUFBRSxDQUFFLENBQUM7O0FBRXpDLE9BQUcsQ0FBQyxtQkFBbUIsQ0FBQyxNQUFNLENBQUUsWUFBWTtBQUMzQyxTQUFHLENBQUMsS0FBSyxDQUFFLE1BQU0sRUFBRSxxQkFBcUIsQ0FBRSxDQUFDO0FBQzVDLGNBQVEsQ0FBQyxHQUFHLENBQUUsRUFBRSxVQUFVLEVBQUUsU0FBUyxFQUFFLENBQUUsQ0FBQztLQUN6QyxDQUFFLENBQUM7O0FBRUosT0FBRyxDQUFDLG9CQUFvQixDQUFDLE1BQU0sQ0FBRSxZQUFZO0FBQzVDLFNBQUcsQ0FBQyxLQUFLLENBQUUsTUFBTSxFQUFFLHNCQUFzQixDQUFFLENBQUM7QUFDN0MsY0FBUSxDQUFDLEdBQUcsQ0FBRSxFQUFFLFVBQVUsRUFBRSxRQUFRLEVBQUUsQ0FBRSxDQUFDO0tBQ3hDLENBQUUsQ0FBQztHQUVKOztBQUVELFNBQU87O0FBRU4sWUFBUSxFQUFFLEdBQUc7QUFDYixTQUFLLEVBQUUsRUFBRTtBQUNULGNBQVUsRUFBRSxJQUFJO0FBQ2hCLGdCQUFZLEVBQUUsT0FBTztBQUNyQixXQUFPLEVBQUUsSUFBSTtBQUNiLGVBQVcsRUFBRSxpQ0FBaUM7O0dBRTlDLENBQUM7Q0FFRixDQUFFLENBQUM7Ozs7O0FDeERKLE1BQU0sQ0FBQyxPQUFPLEdBQUcsQ0FBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLFVBQVcsR0FBRyxFQUFFLEdBQUcsRUFBRzs7QUFFdEQsS0FBSSxVQUFVLEdBQUcsSUFBSSxDQUFDOztBQUV0QixVQUFTLGFBQWEsQ0FBRSxJQUFJLEVBQUc7QUFDOUIsWUFBVSxHQUFHLElBQUksQ0FBQztFQUNsQjs7QUFFRCxVQUFTLGFBQWEsQ0FBRSxJQUFJLEVBQUc7QUFDOUIsU0FBTyxVQUFVLENBQUM7RUFDbEI7O0FBRUQsVUFBUyxJQUFJLEdBQUc7QUFDZixLQUFHLENBQUMsbUJBQW1CLENBQUMsSUFBSSxFQUFFLENBQUM7RUFDL0I7O0FBRUQsVUFBUyxLQUFLLEdBQUc7QUFDaEIsS0FBRyxDQUFDLG9CQUFvQixDQUFDLElBQUksRUFBRSxDQUFDO0VBQ2hDOztBQUVELFFBQU87QUFDTixlQUFhLEVBQWIsYUFBYTtBQUNiLGVBQWEsRUFBYixhQUFhO0FBQ2IsTUFBSSxFQUFKLElBQUk7QUFDSixPQUFLLEVBQUwsS0FBSztFQUNMLENBQUM7Q0FFRixDQUFFLENBQUM7Ozs7O0FDM0JKLE1BQU0sQ0FBQyxPQUFPLEdBQUcsQ0FBRSxZQUFZOztBQUU5QixLQUFJLFlBQVksR0FBRyxLQUFLLENBQUM7QUFDekIsS0FBSSxlQUFlLEdBQUcsRUFBRSxDQUFDOztBQUV6QixLQUFJLENBQUMsV0FBVyxHQUFHLFlBQVk7QUFDOUIsY0FBWSxHQUFHLElBQUksQ0FBQztFQUNwQixDQUFDOztBQUVGLEtBQUksQ0FBQyxvQkFBb0IsR0FBRyxZQUFZO0FBQ3ZDLE9BQU0sSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxTQUFTLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFHO0FBQzVDLGtCQUFlLENBQUMsSUFBSSxDQUFFLFNBQVMsQ0FBRSxDQUFDLENBQUUsQ0FBRSxDQUFDO0dBQ3ZDO0VBQ0QsQ0FBQzs7QUFFRixLQUFJLENBQUMsSUFBSSxHQUFHLFlBQU07O0FBRWpCLFdBQVMsS0FBSyxHQUFHO0FBQ2hCLE9BQUssQ0FBQyxZQUFZLEVBQUcsT0FBTztBQUM1QixPQUFJLFNBQVMsR0FBRyxTQUFTLENBQUUsQ0FBQyxDQUFFLENBQUM7QUFDL0IsT0FBSSxVQUFVLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFFLFNBQVMsRUFBRSxDQUFDLENBQUUsQ0FBQztBQUM1RCxPQUFLLFNBQVMsS0FBSyxLQUFLLEVBQUc7QUFDMUIsV0FBTyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUUsT0FBTyxFQUFFLFVBQVUsQ0FBRSxDQUFDO0lBQzNDLE1BQU0sSUFBSyxTQUFTLEtBQUssTUFBTSxFQUFHO0FBQ2xDLFdBQU8sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFFLE9BQU8sRUFBRSxVQUFVLENBQUUsQ0FBQztJQUMxQyxNQUFNLElBQUssU0FBUyxLQUFLLE1BQU0sRUFBRztBQUNsQyxXQUFPLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBRSxPQUFPLEVBQUUsVUFBVSxDQUFFLENBQUM7SUFDMUMsTUFBTSxJQUFLLGVBQWUsQ0FBQyxPQUFPLENBQUUsU0FBUyxDQUFFLEtBQUssQ0FBQyxDQUFDLEVBQUc7QUFDekQsV0FBTyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUUsT0FBTyxFQUFFLFVBQVUsQ0FBRSxDQUFDO0lBQ3pDO0dBQ0Q7O0FBRUQsU0FBTztBQUNOLFFBQUssRUFBTCxLQUFLO0dBQ0wsQ0FBQztFQUVGLENBQUM7Q0FFRixDQUFFLENBQUM7Ozs7O0FDdENKLE1BQU0sQ0FBQyxPQUFPLEdBQUcsQ0FBRSxZQUFZLEVBQUUsVUFBVyxVQUFVLEVBQUc7O0FBRXhELEtBQUksR0FBRyxHQUFHOztBQUVULEtBQUcsRUFBRTtBQUNKLFNBQU0sRUFBRSxnQkFBVyxFQUFFLEVBQUc7QUFBRSxjQUFVLENBQUMsR0FBRyxDQUFFLEtBQUssRUFBRSxFQUFFLENBQUUsQ0FBQztJQUFFO0FBQ3hELE9BQUksRUFBRSxnQkFBWTtBQUFFLGNBQVUsQ0FBQyxVQUFVLENBQUUsS0FBSyxDQUFFLENBQUM7SUFBRTtHQUNyRDtBQUNELHFCQUFtQixFQUFFO0FBQ3BCLFNBQU0sRUFBRSxnQkFBVyxFQUFFLEVBQUc7QUFBRSxjQUFVLENBQUMsR0FBRyxDQUFFLHFCQUFxQixFQUFFLEVBQUUsQ0FBRSxDQUFDO0lBQUU7QUFDeEUsT0FBSSxFQUFFLGdCQUFZO0FBQUUsY0FBVSxDQUFDLFVBQVUsQ0FBRSxxQkFBcUIsQ0FBRSxDQUFDO0lBQUU7R0FDckU7QUFDRCxzQkFBb0IsRUFBRTtBQUNyQixTQUFNLEVBQUUsZ0JBQVcsRUFBRSxFQUFHO0FBQUUsY0FBVSxDQUFDLEdBQUcsQ0FBRSxzQkFBc0IsRUFBRSxFQUFFLENBQUUsQ0FBQztJQUFFO0FBQ3pFLE9BQUksRUFBRSxnQkFBWTtBQUFFLGNBQVUsQ0FBQyxVQUFVLENBQUUsc0JBQXNCLENBQUUsQ0FBQztJQUFFO0dBQ3RFOztFQUVELENBQUM7O0FBRUYsUUFBTyxHQUFHLENBQUM7Q0FFWCxDQUFFLENBQUM7Ozs7O0FDckJKLE1BQU0sQ0FBQyxPQUFPLEdBQUcsQ0FBRSxTQUFTLEVBQUUsUUFBUSxFQUFFLE1BQU0sRUFBRSxVQUFXLE9BQU8sRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFHOztBQUVsRixVQUFTLElBQUksQ0FBRSxNQUFNLEVBQUUsUUFBUSxFQUFHOztBQUVqQyxRQUFNLENBQUMsY0FBYyxDQUFFLFFBQVEsQ0FBRSxDQUFDO0FBQ2xDLEdBQUMsQ0FBRSxPQUFPLENBQUUsQ0FBQyxFQUFFLENBQUUsUUFBUSxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUUsTUFBTSxDQUFDLGNBQWMsRUFBRSxHQUFHLENBQUUsQ0FBRSxDQUFDO0FBQ3pFLFVBQVEsQ0FBQyxFQUFFLENBQUUsT0FBTyxFQUFFLFVBQVcsR0FBRyxFQUFHO0FBQ3RDLFNBQU0sQ0FBQyxFQUFFLENBQUMsUUFBUSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE1BQU0sQ0FBRSxDQUFDO0dBQzVELENBQUUsQ0FBQzs7QUFFSixRQUFNLENBQUMsS0FBSyxFQUFFLENBQUM7RUFFZjs7QUFFRCxRQUFPO0FBQ04sVUFBUSxFQUFFLEdBQUc7QUFDYixTQUFPLEVBQUUsSUFBSTtBQUNiLFlBQVUsRUFBRSxJQUFJO0FBQ2hCLFVBQVEsRUFBRSxtQ0FBbUM7RUFDN0MsQ0FBQztDQUVGLENBQUUsQ0FBQzs7Ozs7QUNyQkosTUFBTSxDQUFDLE9BQU8sR0FBRyxDQUFFLFNBQVMsRUFBRSxVQUFXLE9BQU8sRUFBRzs7QUFFbEQsS0FBSSxFQUFFLEdBQUc7QUFDUixRQUFNLEVBQUUsSUFBSTtBQUNaLE9BQUssRUFBRSxJQUFJLEtBQUssRUFBRTtBQUNsQixPQUFLLEVBQUUsSUFBSSxLQUFLLENBQUMsS0FBSyxFQUFFO0FBQ3hCLE9BQUssRUFBRSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsS0FBSyxFQUFFO0FBQ3hCLFFBQU0sRUFBRSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsTUFBTSxFQUFFO0FBQzFCLFFBQU0sRUFBRSxJQUFJLEtBQUssQ0FBQyxpQkFBaUIsQ0FBRSxFQUFFLEVBQUUsSUFBSSxDQUFDLEtBQUssR0FBRyxJQUFJLENBQUMsTUFBTSxFQUFFLEVBQUUsRUFBRSxNQUFNLENBQUU7QUFDL0UsVUFBUSxFQUFFLElBQUksS0FBSyxDQUFDLGFBQWEsRUFBRTtBQUNuQyxjQUFZLEVBQUUsSUFBSSxDQUFDLEtBQUssR0FBRyxJQUFJLENBQUMsTUFBTTtBQUN0QyxhQUFXLEVBQUUsT0FBTyxDQUFDLGdCQUFnQixJQUFJLENBQUM7QUFDMUMsU0FBTyxFQUFFLElBQUksQ0FBQyxLQUFLLEdBQUcsR0FBRztBQUN6QixTQUFPLEVBQUUsSUFBSSxDQUFDLE1BQU0sR0FBRyxHQUFHO0FBQzFCLFVBQVEsRUFBRSxDQUFDO0VBQ1gsQ0FBQzs7QUFFRixHQUFFLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBRSxFQUFFLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxNQUFNLENBQUUsQ0FBQzs7QUFFM0MsVUFBUyxjQUFjLENBQUUsTUFBTSxFQUFHO0FBQ2pDLElBQUUsQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFDO0FBQ25CLFFBQU0sQ0FBQyxNQUFNLENBQUUsRUFBRSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUUsQ0FBQztBQUN4QyxRQUFNLENBQUMsTUFBTSxDQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFFLENBQUM7RUFDckM7O0FBRUQsVUFBUyxjQUFjLEdBQUc7QUFDekIsSUFBRSxDQUFDLEtBQUssR0FBRyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsS0FBSyxFQUFFLENBQUM7QUFDN0IsSUFBRSxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsTUFBTSxFQUFFLENBQUM7QUFDL0IsSUFBRSxDQUFDLFdBQVcsR0FBRyxPQUFPLENBQUMsZ0JBQWdCLElBQUksQ0FBQyxDQUFDO0FBQy9DLElBQUUsQ0FBQyxZQUFZLEdBQUcsRUFBRSxDQUFDLEtBQUssR0FBRyxFQUFFLENBQUMsTUFBTSxDQUFDO0FBQ3ZDLElBQUUsQ0FBQyxNQUFNLENBQUMsTUFBTSxHQUFHLEVBQUUsQ0FBQyxZQUFZLENBQUM7QUFDbkMsSUFBRSxDQUFDLE1BQU0sQ0FBQyxzQkFBc0IsRUFBRSxDQUFDO0FBQ25DLElBQUUsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFFLEVBQUUsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBRSxDQUFDO0VBQzNDOztBQUVELFVBQVMsS0FBSyxHQUFHLEVBRWhCOztBQUVELFVBQVMsTUFBTSxHQUFHOztBQUVqQixNQUFLLElBQUksQ0FBQyxHQUFHLENBQUUsRUFBRSxDQUFDLFFBQVEsQ0FBRSxHQUFHLEtBQUssRUFBRztBQUN0QyxLQUFFLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLFFBQVEsR0FBRyxHQUFHLENBQUM7QUFDMUMsS0FBRSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUUsRUFBRSxDQUFDLFFBQVEsR0FBRyxLQUFLLENBQUUsQ0FBQztBQUN6QyxLQUFFLENBQUMsUUFBUSxJQUFJLElBQUksQ0FBQztHQUNwQjtFQUVEOzs7QUFHRCxVQUFTLEdBQUcsR0FBRzs7QUFFZCx1QkFBcUIsQ0FBRSxHQUFHLENBQUUsQ0FBQztBQUM3QixRQUFNLEVBQUUsQ0FBQztBQUNULElBQUUsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFFLEVBQUUsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBRSxDQUFDO0FBQzFDLElBQUUsQ0FBQyxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUM7RUFFbEI7O0FBRUQsVUFBUyxLQUFLLEdBQUc7QUFDaEIsT0FBSyxFQUFFLENBQUM7QUFDUixLQUFHLEVBQUUsQ0FBQztFQUNOOztBQUVELFVBQVMsV0FBVyxHQUFHO0FBQ3RCLElBQUUsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsQ0FBRSxDQUFDO0FBQ2xDLElBQUUsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsQ0FBRSxDQUFDO0VBQ2xDOztBQUVELFFBQU87QUFDTixJQUFFLEVBQUYsRUFBRTtBQUNGLGdCQUFjLEVBQWQsY0FBYztBQUNkLGdCQUFjLEVBQWQsY0FBYztBQUNkLE9BQUssRUFBTCxLQUFLO0FBQ0wsYUFBVyxFQUFYLFdBQVc7RUFDWCxDQUFDO0NBRUYsQ0FBRSxDQUFDOzs7OztBQzdFSixNQUFNLENBQUMsT0FBTyxHQUFHLENBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxVQUFVLEVBQUUsWUFBWSxFQUM1RCxVQUFXLEdBQUcsRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFFLFVBQVUsRUFBRzs7QUFFOUMsS0FBSSxVQUFVLEdBQUcsSUFBSSxLQUFLLENBQUMsUUFBUSxFQUFFLENBQUM7QUFDdEMsT0FBTSxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFFLFVBQVUsQ0FBRSxDQUFDOztBQUVsQyxVQUFTLGdCQUFnQixDQUFFLGlCQUFpQixFQUFFLGNBQWMsRUFBRzs7QUFFOUQsTUFBSSxNQUFNLEdBQUcsSUFBSSxLQUFLLENBQUMsT0FBTyxFQUFFLENBQUM7QUFDakMsTUFBSSxNQUFNLEdBQUcsR0FBRyxDQUFDO0FBQ2pCLE9BQU0sSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxpQkFBaUIsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUc7O0FBRXBELE9BQUksY0FBYyxHQUFHLFVBQVUsQ0FBQyxJQUFJLENBQUUsSUFBSSxDQUFFLENBQUM7QUFDN0MsaUJBQWMsQ0FBQyxTQUFTLEdBQUcsaUJBQWlCLENBQUUsQ0FBQyxDQUFFLENBQUM7O0FBRWxELE9BQUksbUJBQW1CLEdBQUcsUUFBUSxDQUFFLG1CQUFtQixDQUFFLENBQUUsY0FBYyxDQUFFLENBQUUsQ0FBQyxDQUFFLENBQUM7QUFDakYsT0FBSSxRQUFRLEdBQUcsSUFBSSxLQUFLLENBQUMsV0FBVyxDQUFFLG1CQUFtQixDQUFFLENBQUM7OztBQUc1RCxXQUFRLENBQUMsS0FBSyxHQUFHLGNBQWMsQ0FBQzs7QUFFaEMsT0FBSSxJQUFJLEdBQUcsQ0FBQyxHQUFHLGNBQWMsQ0FBQztBQUM5QixPQUFJLEdBQUcsR0FBRyxJQUFJLEdBQUcsS0FBSyxHQUFHLElBQUksQ0FBQyxFQUFFLENBQUM7QUFDakMsV0FBUSxDQUFDLFFBQVEsQ0FBQyxDQUFDLEdBQUcsQ0FBRSxNQUFNLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBRSxHQUFHLENBQUUsQ0FBQztBQUNqRCxXQUFRLENBQUMsUUFBUSxDQUFDLENBQUMsR0FBRyxFQUFJLElBQUksR0FBRyxDQUFDLENBQUEsQUFBRSxHQUFHLEdBQUcsQ0FBQztBQUMzQyxXQUFRLENBQUMsUUFBUSxDQUFDLENBQUMsR0FBRyxNQUFNLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBRSxHQUFHLENBQUUsQ0FBQzs7QUFFL0MsU0FBTSxDQUFDLEdBQUcsQ0FBRSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsQ0FBQyxHQUFHLENBQUMsRUFBRSxRQUFRLENBQUMsUUFBUSxDQUFDLENBQUMsRUFBRSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBRSxDQUFDOztBQUV0RixXQUFRLENBQUMsTUFBTSxDQUFFLE1BQU0sQ0FBRSxDQUFDO0FBQzFCLGFBQVUsQ0FBQyxHQUFHLENBQUUsUUFBUSxDQUFFLENBQUM7R0FFM0I7O0FBRUQsS0FBRyxDQUFDLEtBQUssQ0FBRSxNQUFNLEVBQUUsZUFBZSxFQUFFLFVBQVUsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFFLENBQUM7RUFFakU7O0FBRUQsVUFBUyxRQUFRLEdBQUc7QUFDbkIsWUFBVSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUUsVUFBVyxNQUFNLEVBQUc7QUFDaEQsU0FBTSxDQUFDLGNBQWMsRUFBRSxDQUFDO0FBQ3hCLFNBQU0sQ0FBQyxLQUFLLENBQUMsUUFBUSxFQUFFLENBQUM7R0FDeEIsQ0FBRSxDQUFDO0FBQ0osWUFBVSxDQUFDLFFBQVEsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDO0VBQy9COztBQUVELFFBQU87QUFDTixrQkFBZ0IsRUFBaEIsZ0JBQWdCO0FBQ2hCLFVBQVEsRUFBUixRQUFRO0VBQ1IsQ0FBQztDQUVGLENBQUUsQ0FBQzs7Ozs7QUNuREosTUFBTSxDQUFDLE9BQU8sR0FBRyxDQUFFLFFBQVEsRUFBRSx3QkFBd0IsRUFBRSxVQUFXLE1BQU0sRUFBRSxzQkFBc0IsRUFBRzs7QUFFbEcsVUFBUyxJQUFJLENBQUUsTUFBTSxFQUFFLFFBQVEsRUFBRzs7O0FBR2pDLE1BQUksR0FBRyxHQUFHLElBQUksS0FBSyxFQUFFLENBQUM7QUFDdEIsTUFBSSxNQUFNLEdBQUcsaUNBQWlDLEdBQUcsTUFBTSxDQUFDLFNBQVMsQ0FBQyxXQUFXLENBQUM7QUFDOUUsS0FBRyxDQUFDLE1BQU0sR0FBRyxZQUFZOzs7QUFHeEIsV0FBUSxDQUFDLEdBQUcsQ0FBRTtBQUNiLFdBQU8sRUFBRSxPQUFPO0FBQ2hCLFlBQVEsRUFBRSxPQUFPO0FBQ2pCLHVCQUFtQixFQUFFLFdBQVc7QUFDaEMscUJBQWlCLEVBQUUsYUFBYTtBQUNoQyxzQkFBa0IsRUFBRSxNQUFNLEdBQUcsTUFBTSxHQUFHLEdBQUc7QUFDekMsYUFBUyxFQUFFLE1BQU07SUFDakIsQ0FBRSxDQUFDO0FBQ0osV0FBUSxDQUFDLE1BQU0sQ0FBRSxJQUFJLENBQUUsQ0FBQztHQUV4QixDQUFDO0FBQ0YsS0FBRyxDQUFDLEdBQUcsR0FBRyxNQUFNLENBQUM7O0FBRWpCLFVBQVEsQ0FBQyxFQUFFLENBQUUsT0FBTyxFQUFFLFVBQVcsR0FBRyxFQUFHO0FBQ3RDLFNBQU0sQ0FBQyxFQUFFLENBQUUsYUFBYSxFQUFFLEVBQUUsT0FBTyxFQUFFLE1BQU0sQ0FBQyxTQUFTLENBQUMsRUFBRSxFQUFFLENBQUUsQ0FBQztBQUM3RCx5QkFBc0IsQ0FBQyxhQUFhLENBQUUsTUFBTSxDQUFDLFNBQVMsQ0FBRSxDQUFDO0dBQ3pELENBQUUsQ0FBQztFQUVKOztBQUVELFFBQU87QUFDTixVQUFRLEVBQUUsR0FBRztBQUNiLFNBQU8sRUFBRSxJQUFJO0FBQ2IsWUFBVSxFQUFFLElBQUk7QUFDaEIsVUFBUSxFQUFFLGdDQUFnQztFQUMxQyxDQUFDO0NBRUYsQ0FBRSxDQUFDOzs7OztBQ3JDSixPQUFPLENBQUMsTUFBTSxDQUFFLEtBQUssRUFBRSxDQUN0QixXQUFXLEVBQ1gsV0FBVyxDQUNYLENBQUUsQ0FDRixRQUFRLENBQUUsY0FBYyxFQUFFLHdCQUF3QixDQUFFLENBQ3BELFFBQVEsQ0FBRSxVQUFVLEVBQUU7QUFDdEIsSUFBRyxFQUFFLGtDQUFrQztBQUN2QyxJQUFHLEVBQUUsOEJBQThCO0NBQ25DLENBQUUsQ0FFRixRQUFRLENBQUUsS0FBSyxFQUFFLE9BQU8sQ0FBRSxtQkFBbUIsQ0FBRSxDQUFFLENBRWpELE9BQU8sQ0FBRSxNQUFNLEVBQUUsT0FBTyxDQUFFLFdBQVcsQ0FBRSxDQUFFLENBQ3pDLFVBQVUsQ0FBRSxVQUFVLEVBQUUsT0FBTyxDQUFFLGdCQUFnQixDQUFFLENBQUUsQ0FDckQsT0FBTyxDQUFFLE1BQU0sRUFBRSxPQUFPLENBQUUsZUFBZSxDQUFFLENBQUUsQ0FDN0MsT0FBTyxDQUFFLEtBQUssRUFBRSxPQUFPLENBQUUsaUJBQWlCLENBQUUsQ0FBRSxDQUM5QyxVQUFVLENBQUUsaUJBQWlCLEVBQUUsT0FBTyxDQUFFLHVCQUF1QixDQUFFLENBQUUsQ0FDbkUsU0FBUyxDQUFFLFNBQVMsRUFBRSxPQUFPLENBQUUsd0JBQXdCLENBQUUsQ0FBRSxDQUMzRCxPQUFPLENBQUUsUUFBUSxFQUFFLE9BQU8sQ0FBRSx1QkFBdUIsQ0FBRSxDQUFFLENBQ3ZELE9BQU8sQ0FBRSxPQUFPLEVBQUUsT0FBTyxDQUFFLHNCQUFzQixDQUFFLENBQUUsQ0FDckQsU0FBUyxDQUFFLFFBQVEsRUFBRSxPQUFPLENBQUUsdUJBQXVCLENBQUUsQ0FBRSxDQUV6RCxVQUFVLENBQUUsWUFBWSxFQUFFLE9BQU8sQ0FBRSx1QkFBdUIsQ0FBRSxDQUFFLENBQzlELFVBQVUsQ0FBRSxZQUFZLEVBQUUsT0FBTyxDQUFFLHVCQUF1QixDQUFFLENBQUUsQ0FDOUQsVUFBVSxDQUFFLGFBQWEsRUFBRSxPQUFPLENBQUUsd0JBQXdCLENBQUUsQ0FBRSxDQUVoRSxPQUFPLENBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBRSxvQkFBb0IsQ0FBRSxDQUFFLENBQ2xELE9BQU8sQ0FBRSxXQUFXLEVBQUUsT0FBTyxDQUFFLHlCQUF5QixDQUFFLENBQUUsQ0FDNUQsT0FBTyxDQUFFLGlCQUFpQixFQUFFLE9BQU8sQ0FBRSwrQkFBK0IsQ0FBRSxDQUFFLENBRXhFLFVBQVUsQ0FBRSxxQkFBcUIsRUFBRSxPQUFPLENBQUUsZ0NBQWdDLENBQUUsQ0FBRSxDQUNoRixPQUFPLENBQUUsaUJBQWlCLEVBQUUsT0FBTyxDQUFFLDBCQUEwQixDQUFFLENBQUUsQ0FDbkUsU0FBUyxDQUFFLGlCQUFpQixFQUFFLE9BQU8sQ0FBRSwwQkFBMEIsQ0FBRSxDQUFFLENBQ3JFLE9BQU8sQ0FBRSx3QkFBd0IsRUFBRSxPQUFPLENBQUUsaUNBQWlDLENBQUUsQ0FBRSxDQUNqRixTQUFTLENBQUUsZ0JBQWdCLEVBQUUsT0FBTyxDQUFFLHlCQUF5QixDQUFFLENBQUUsQ0FFbkUsTUFBTSxDQUFFLENBQUUsZ0JBQWdCLEVBQUUsb0JBQW9CLEVBQUUsZUFBZSxFQUNsRSxVQUFXLGNBQWMsRUFBRSxrQkFBa0IsRUFBRSxhQUFhLEVBQUc7O0FBRTlELG1CQUFrQixDQUFDLFNBQVMsQ0FBRSxHQUFHLENBQUUsQ0FBQzs7QUFFcEMsZUFBYyxDQUNaLEtBQUssQ0FBRSxPQUFPLEVBQUU7QUFDaEIsS0FBRyxFQUFFLEdBQUc7QUFDUixhQUFXLEVBQUUsdUJBQXVCO0VBQ3BDLENBQUUsQ0FDRixLQUFLLENBQUUsYUFBYSxFQUFFO0FBQ3RCLEtBQUcsRUFBRSxpQkFBaUI7QUFDdEIsYUFBVyxFQUFFLHVCQUF1QjtBQUNwQyxZQUFVLEVBQUUsaUJBQWlCO0FBQzdCLGNBQVksRUFBRSxJQUFJO0FBQ2xCLFNBQU8sRUFBRTtBQUNSLFlBQVMsRUFBRSxDQUFFLGNBQWMsRUFBRSxNQUFNLEVBQUUsVUFBVyxZQUFZLEVBQUUsSUFBSSxFQUFHO0FBQ3BFLFdBQU8sSUFBSSxDQUFDLFVBQVUsQ0FBRSxZQUFZLENBQUMsT0FBTyxDQUFFLENBQUM7SUFDL0MsQ0FBQztHQUNGO0VBQ0QsQ0FBRSxDQUNGLEtBQUssQ0FBRSxRQUFRLEVBQUU7QUFDakIsS0FBRyxFQUFFLFNBQVM7QUFDZCxhQUFXLEVBQUUsd0JBQXdCO0FBQ3JDLFlBQVUsRUFBRSxZQUFZO0FBQ3hCLGNBQVksRUFBRSxRQUFRO0VBQ3RCLENBQUUsQ0FDRixLQUFLLENBQUUsUUFBUSxFQUFFO0FBQ2pCLEtBQUcsRUFBRSxTQUFTO0FBQ2QsYUFBVyxFQUFFLHdCQUF3QjtBQUNyQyxZQUFVLEVBQUUsWUFBWTtBQUN4QixjQUFZLEVBQUUsUUFBUTtFQUN0QixDQUFFLENBQ0YsS0FBSyxDQUFFLFNBQVMsRUFBRTtBQUNsQixLQUFHLEVBQUUsVUFBVTtBQUNmLFlBQVUsRUFBRSxhQUFhO0VBQ3pCLENBQUUsQ0FDRixLQUFLLENBQUMsWUFBWSxFQUFFO0FBQ3BCLEtBQUcsRUFBRSxhQUFhO0FBQ2xCLGFBQVcsRUFBRSw0QkFBNEI7QUFDekMsWUFBVSxFQUFFLHFCQUFxQjtBQUNqQyxjQUFZLEVBQUUsSUFBSTtBQUNsQixTQUFPLEVBQUU7QUFDUixZQUFTLEVBQUUsQ0FBRSxNQUFNLEVBQUUsVUFBVyxJQUFJLEVBQUc7QUFDdEMsV0FBTyxJQUFJLENBQUMsU0FBUyxFQUFFLENBQUM7SUFDeEIsQ0FBRTtBQUNILHFCQUFrQixFQUFFLENBQUUsaUJBQWlCLEVBQUUsVUFBVyxlQUFlLEVBQUc7QUFDckUsV0FBTyxlQUFlLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztJQUMzQyxDQUFFO0dBQ0g7RUFDRCxDQUFDLENBQ0Y7O0FBRUQsY0FBYSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUUsaUJBQWlCLENBQUUsQ0FBQztDQUVyRCxDQUFFLENBQUUsQ0FDSixHQUFHLENBQUUsQ0FBRSxLQUFLLEVBQUUsWUFBWSxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsaUJBQWlCLEVBQUUsVUFBVyxHQUFHLEVBQUUsVUFBVSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUUsZUFBZSxFQUFHOzs7O0FBSTdILEtBQUksQ0FBQyxTQUFTLENBQUUsSUFBSSxDQUFFLENBQUM7O0FBRXZCLGdCQUFlLENBQUMsaUJBQWlCLEVBQUUsQ0FBQzs7QUFFcEMsV0FBVSxDQUFDLEdBQUcsQ0FBRSxtQkFBbUIsRUFBRSxVQUFXLEtBQUssRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFHOztBQUV4RyxPQUFLLENBQUMsY0FBYyxFQUFFLENBQUM7QUFDdkIsS0FBRyxDQUFDLEtBQUssQ0FBRSxNQUFNLEVBQUUsS0FBSyxDQUFFLENBQUM7QUFDM0IsTUFBSyxLQUFLLEVBQUc7QUFDWixTQUFNLENBQUMsRUFBRSxDQUFFLFFBQVEsQ0FBRSxDQUFDO0dBQ3RCO0VBRUQsQ0FBRSxDQUFDO0NBRUosQ0FBRSxDQUFFLENBQ0osTUFBTSxDQUFFLENBQUUsYUFBYSxFQUFFLGVBQWUsRUFBRSxVQUFXLFdBQVcsRUFBRSxhQUFhLEVBQUc7O0FBRWxGLFlBQVcsQ0FBQyxXQUFXLEVBQUUsQ0FBQztBQUMxQixZQUFXLENBQUMsb0JBQW9CLENBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxNQUFNLENBQUUsQ0FBQzs7QUFFMUQsY0FBYSxDQUFDLDBCQUEwQixDQUFFLEtBQUssQ0FBRSxDQUFDO0NBRWxELENBQUUsQ0FBRSxDQUNKOzs7OztBQ3ZIRCxNQUFNLENBQUMsT0FBTyxHQUFHLENBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsS0FBSyxFQUFFLE9BQU8sRUFBRSxRQUFRLEVBQUUsTUFBTSxFQUFFLFFBQVEsRUFDdEYsVUFBVyxHQUFHLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxHQUFHLEVBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFHOztBQUVoRSxLQUFJLEVBQUUsR0FBRyxJQUFJLENBQUM7QUFDZCxHQUFFLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQztBQUNmLEdBQUUsQ0FBQyxNQUFNLEdBQUc7QUFDWCxPQUFLLEVBQUUsRUFBRTtFQUNULENBQUM7QUFDRixHQUFFLENBQUMsVUFBVSxHQUFHLElBQUksQ0FBQzs7QUFFckIsT0FBTSxDQUFDLE1BQU0sQ0FBRSxJQUFJLENBQUMsTUFBTSxFQUFFLFVBQVcsUUFBUSxFQUFHOztBQUVqRCxJQUFFLENBQUMsVUFBVSxHQUFHLFFBQVEsQ0FBQztBQUN6QixPQUFLLENBQUMsZ0JBQWdCLENBQUUsUUFBUSxDQUFDLEtBQUssQ0FBRSxJQUFJLENBQUMsYUFBYSxDQUFFLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBRSxDQUFDO0VBRW5GLEVBQUUsSUFBSSxDQUFFLENBQUM7O0FBRVYsS0FBSSxTQUFTLEdBQUcsRUFBRSxDQUFDO0FBQ25CLEdBQUUsQ0FBQyxNQUFNLEdBQUcsWUFBWTtBQUN2QixNQUFLLEVBQUUsQ0FBQyxNQUFNLENBQUMsS0FBSyxLQUFLLEVBQUUsRUFBRyxPQUFPO0FBQ3JDLE1BQUssU0FBUyxLQUFLLEVBQUUsQ0FBQyxNQUFNLENBQUMsS0FBSyxFQUFHO0FBQ3BDLFlBQVMsR0FBRyxFQUFFLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQztBQUM1QixPQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7QUFDbkIsUUFBSyxDQUFDLFFBQVEsRUFBRSxDQUFDO0FBQ2pCLFNBQU0sQ0FBQyxXQUFXLEVBQUUsQ0FBQztHQUNyQjtBQUNELE1BQUssTUFBTSxDQUFDLE9BQU8sQ0FBQyxJQUFJLEtBQUssT0FBTyxFQUFHO0FBQ3RDLFNBQU0sQ0FBQyxFQUFFLENBQUUsT0FBTyxDQUFFLENBQUM7R0FDckI7QUFDRCxNQUFJLENBQUMsYUFBYSxDQUFFLEVBQUUsQ0FBQyxNQUFNLENBQUUsQ0FBQztFQUNoQyxDQUFDOzs7QUFHRixPQUFNLENBQUMsS0FBSyxHQUFHLE1BQU0sQ0FBQztBQUN0QixHQUFFLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQztBQUNmLEdBQUUsQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFDO0FBQ2pCLEdBQUUsQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFDO0FBQ25CLEdBQUUsQ0FBQyxLQUFLLEdBQUcsTUFBTSxDQUFDOztBQUVsQixJQUFHLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBRSxZQUFZO0FBQzNCLEtBQUcsQ0FBQyxLQUFLLENBQUUsTUFBTSxFQUFFLHFCQUFxQixDQUFFLENBQUM7RUFDM0MsQ0FBRSxDQUFDO0NBRUosQ0FBRSxDQUFDOzs7OztBQzNDSixNQUFNLENBQUMsT0FBTyxHQUFHLENBQUUsS0FBSyxFQUFFLGNBQWMsRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLFVBQVcsR0FBRyxFQUFFLFlBQVksRUFBRSxLQUFLLEVBQUUsRUFBRSxFQUFHOztBQUVsRyxLQUFJLFdBQVcsR0FBRyxZQUFZLEdBQUcsWUFBWSxDQUFDO0FBQzlDLEtBQUksVUFBVSxHQUFHLElBQUksQ0FBQzs7QUFFdEIsS0FBSSxjQUFjLEdBQUcsSUFBSSxDQUFDOztBQUUxQixVQUFTLE1BQU0sQ0FBRSxJQUFJLEVBQUc7OztBQUd2QixZQUFVLENBQUMsSUFBSSxDQUFFLEVBQUUsY0FBYyxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsRUFBRSxFQUFFLENBQUUsQ0FBQztBQUN4RCxLQUFHLEVBQUUsQ0FBQztFQUNOOztBQUVELFVBQVMsT0FBTyxHQUFHO0FBQ2xCLFNBQU8sVUFBVSxDQUFDLE1BQU0sS0FBSyxDQUFDLENBQUM7RUFDL0I7O0FBRUQsVUFBUyxpQkFBaUIsR0FBRzs7QUFFNUIsTUFBSSxRQUFRLEdBQUcsRUFBRSxDQUFDLEtBQUssRUFBRSxDQUFDOztBQUUxQixNQUFLLFVBQVUsS0FBSyxJQUFJLEVBQUc7QUFDMUIsV0FBUSxDQUFDLE9BQU8sQ0FBRSxVQUFVLENBQUUsQ0FBQztHQUMvQixNQUFNO0FBQ04sUUFBSyxDQUFDLEdBQUcsQ0FBRSxXQUFXLEVBQUUsRUFBRSxXQUFXLEVBQUUsSUFBSSxFQUFFLENBQUUsQ0FDN0MsSUFBSSxDQUFFLFVBQVcsR0FBRyxFQUFHO0FBQ3ZCLE9BQUcsQ0FBQyxLQUFLLENBQUUsTUFBTSxFQUFFLGlDQUFpQyxFQUFFLEdBQUcsQ0FBRSxDQUFDO0FBQzVELFFBQUssR0FBRyxDQUFDLElBQUksRUFBRztBQUNmLGVBQVUsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDO0tBQ3RCLE1BQU07QUFDTixlQUFVLEdBQUcsRUFBRSxDQUFDO0tBQ2hCO0FBQ0QsWUFBUSxDQUFDLE9BQU8sQ0FBRSxJQUFJLENBQUUsQ0FBQztJQUN6QixFQUFFLFVBQVcsR0FBRyxFQUFHO0FBQ25CLE9BQUcsQ0FBQyxLQUFLLENBQUUsTUFBTSxFQUFFLGlDQUFpQyxFQUFFLEdBQUcsQ0FBRSxDQUFDO0FBQzVELFlBQVEsQ0FBQyxNQUFNLENBQUUsR0FBRyxDQUFFLENBQUM7SUFDdkIsQ0FBRSxDQUFDO0dBQ0w7O0FBRUQsU0FBTyxRQUFRLENBQUMsT0FBTyxDQUFDO0VBRXhCOztBQUVELFVBQVMsT0FBTyxDQUFFLE1BQU0sRUFBRSxjQUFjLEVBQUc7QUFDMUMsT0FBTSxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLFVBQVUsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFHLEVBQUc7QUFDOUMsT0FBSyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsY0FBYyxLQUFLLGNBQWMsRUFBRztBQUN0RCxTQUFNLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFHLEVBQUc7QUFDeEQsU0FBSyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxLQUFLLE1BQU0sRUFBRztBQUN6QyxhQUFPLElBQUksQ0FBQztNQUNaO0tBQ0Q7SUFDRDtHQUNEO0FBQ0QsU0FBTyxLQUFLLENBQUM7RUFDYjs7QUFFRCxVQUFTLEdBQUcsR0FBRztBQUNkLE9BQUssQ0FBQyxHQUFHLENBQUUsV0FBVyxFQUFFLFVBQVUsRUFBRSxFQUFFLFdBQVcsRUFBRSxJQUFJLEVBQUUsQ0FBRSxDQUN6RCxJQUFJLENBQUUsVUFBVyxHQUFHLEVBQUc7QUFDdkIsTUFBRyxDQUFDLEtBQUssQ0FBRSxNQUFNLEVBQUUsbUJBQW1CLEVBQUUsR0FBRyxDQUFFLENBQUM7R0FDOUMsRUFBRSxVQUFXLEdBQUcsRUFBRztBQUNuQixNQUFHLENBQUMsS0FBSyxDQUFFLEtBQUssRUFBRSxtQkFBbUIsRUFBRSxHQUFHLENBQUUsQ0FBQztHQUM3QyxDQUFFLENBQUM7RUFDTDs7Ozs7QUFLRCxVQUFTLElBQUksQ0FBRSxNQUFNLEVBQUUsWUFBWSxFQUFHO0FBQ3JDLE1BQUssT0FBTyxDQUFFLE1BQU0sRUFBRSxZQUFZLENBQUUsRUFBRztBQUN0QyxVQUFPLEtBQUssQ0FBQztHQUNiO0FBQ0QsT0FBTSxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQyxHQUFHLFVBQVUsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFHLEVBQUc7QUFDOUMsT0FBSyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsY0FBYyxLQUFLLFlBQVksRUFBRztBQUNwRCxjQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBRSxNQUFNLENBQUUsQ0FBQztBQUNwQyxPQUFHLEVBQUUsQ0FBQztBQUNOLFdBQU8sSUFBSSxDQUFDO0lBQ1o7R0FDRDtBQUNELFNBQU8sS0FBSyxDQUFDO0VBQ2I7O0FBRUQsVUFBUyxNQUFNLENBQUUsTUFBTSxFQUFFLFlBQVksRUFBRztBQUN2QyxPQUFNLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsVUFBVSxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUcsRUFBRztBQUM5QyxPQUFLLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxjQUFjLEtBQUssWUFBWSxFQUFHO0FBQ3BELFNBQU0sSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLE1BQU0sRUFBRSxDQUFDLEVBQUcsRUFBRztBQUN4RCxTQUFLLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLEtBQUssTUFBTSxFQUFHO0FBQ3pDLFVBQUksT0FBTyxHQUFHLFVBQVUsQ0FBQyxDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFFLENBQUMsRUFBRSxDQUFDLENBQUUsQ0FBQyxNQUFNLENBQUM7QUFDekQsU0FBRyxFQUFFLENBQUM7QUFDTixhQUFPLE9BQU8sS0FBSyxDQUFDLENBQUM7TUFDckI7S0FDRDtJQUNEO0dBQ0Q7QUFDRCxTQUFPLEtBQUssQ0FBQztFQUNiOztBQUVELFVBQVMsZ0JBQWdCLENBQUUsY0FBYyxFQUFHO0FBQzNDLE9BQU0sSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxVQUFVLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRyxFQUFHO0FBQzlDLE9BQUssVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLGNBQWMsS0FBSyxjQUFjLEVBQUc7QUFDdEQsUUFBSSxPQUFPLEdBQUcsVUFBVSxDQUFDLE1BQU0sQ0FBRSxDQUFDLEVBQUUsQ0FBQyxDQUFFLENBQUMsTUFBTSxDQUFDO0FBQy9DLE9BQUcsRUFBRSxDQUFDO0FBQ04sV0FBTyxPQUFPLEtBQUssQ0FBQyxDQUFDO0lBQ3JCO0dBQ0Q7QUFDRCxTQUFPLEtBQUssQ0FBQztFQUNiOztBQUVELFVBQVMsSUFBSSxHQUFHOztFQUVmOztBQUVELFVBQVMsYUFBYSxHQUFHO0FBQ3hCLFNBQU8sVUFBVSxDQUFDO0VBQ2xCOztBQUVELFVBQVMsTUFBTSxHQUFHO0FBQ2pCLFlBQVUsR0FBRyxJQUFJLENBQUM7QUFDbEIsS0FBRyxDQUFDLEtBQUssQ0FBRSxNQUFNLEVBQUUsMkJBQTJCLENBQUUsQ0FBQztFQUNqRDs7QUFFRCxRQUFPO0FBQ04sZUFBYSxFQUFiLGFBQWE7QUFDYixRQUFNLEVBQU4sTUFBTTtBQUNOLE1BQUksRUFBSixJQUFJO0FBQ0osS0FBRyxFQUFILEdBQUc7QUFDSCxRQUFNLEVBQU4sTUFBTTtBQUNOLGtCQUFnQixFQUFoQixnQkFBZ0I7QUFDaEIsTUFBSSxFQUFKLElBQUk7QUFDSixRQUFNLEVBQU4sTUFBTTtBQUNOLG1CQUFpQixFQUFqQixpQkFBaUI7QUFDakIsU0FBTyxFQUFQLE9BQU87QUFDUCxTQUFPLEVBQVAsT0FBTztFQUNQLENBQUM7Q0FFRixDQUFFLENBQUM7Ozs7O0FDeElKLE1BQU0sQ0FBQyxPQUFPLEdBQUcsQ0FBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLE1BQU0sRUFBRSxlQUFlLEVBQUUsV0FBVyxFQUFFLHdCQUF3QixFQUNsRyxVQUFVLEdBQUcsRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLGFBQWEsRUFBRSxTQUFTLEVBQUUsc0JBQXNCLEVBQUc7O0FBRS9FLEtBQUksRUFBRSxHQUFHLElBQUksQ0FBQztBQUNkLEdBQUUsQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDO0FBQ3pCLElBQUcsQ0FBQyxLQUFLLENBQUUsTUFBTSxFQUFFLDRCQUE0QixFQUFFLEVBQUUsQ0FBQyxTQUFTLENBQUUsQ0FBQzs7QUFFaEUsVUFBUyxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUMsS0FBSyxDQUFDO0FBQ3RDLEtBQUssU0FBUyxDQUFDLEtBQUssS0FBSyxTQUFTLENBQUMsY0FBYyxFQUFHO0FBQ25ELFdBQVMsQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDLEtBQUssR0FBRyxJQUFJLEdBQUcsU0FBUyxDQUFDLGNBQWMsR0FBRyxHQUFHLENBQUM7RUFDOUU7O0FBRUQsS0FBSyxTQUFTLENBQUMsYUFBYSxFQUFHO0FBQzlCLE1BQUksTUFBTSxHQUFHLG9DQUFvQyxHQUFHLFNBQVMsQ0FBQyxhQUFhLENBQUM7QUFDNUUsR0FBQyxDQUFFLFdBQVcsQ0FBRSxDQUFDLEdBQUcsQ0FBRTtBQUNyQixxQkFBa0IsRUFBRSxNQUFNLEdBQUcsTUFBTSxHQUFHLEdBQUc7R0FDekMsQ0FBRSxDQUFDO0VBQ0o7O0FBRUQsR0FBRSxDQUFDLG1CQUFtQixHQUFHLFlBQVk7QUFDcEMsd0JBQXNCLENBQUMsYUFBYSxDQUFFLFNBQVMsQ0FBRSxDQUFDO0FBQ2xELHdCQUFzQixDQUFDLElBQUksRUFBRSxDQUFDO0VBQzlCLENBQUM7Q0FFRixDQUFFLENBQUM7Ozs7O0FDeEJKLE1BQU0sQ0FBQyxPQUFPLEdBQUcsQ0FBRSxZQUFZOztBQUU5QixVQUFTLFFBQVEsQ0FBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRztBQUMxQyxNQUFJLEtBQUssR0FBRyxJQUFJO01BQ2YsVUFBVSxHQUFHLFNBQVMsQ0FBQzs7QUFFeEIsTUFBSSxPQUFPLENBQUM7QUFDWixTQUFPLFlBQVk7O0FBRWxCLE9BQUksT0FBTyxHQUFHLEtBQUs7T0FDbEIsSUFBSSxHQUFHLFVBQVUsQ0FBQztBQUNuQixPQUFJLEtBQUssR0FBRyxTQUFTLEtBQUssR0FBRzs7QUFFNUIsV0FBTyxHQUFHLElBQUksQ0FBQztBQUNmLFFBQUssQ0FBQyxTQUFTLEVBQUcsSUFBSSxDQUFDLEtBQUssQ0FBRSxPQUFPLEVBQUUsSUFBSSxDQUFFLENBQUM7SUFDOUMsQ0FBQztBQUNGLE9BQUksT0FBTyxHQUFHLFNBQVMsSUFBSSxDQUFDLE9BQU8sQ0FBQztBQUNwQyxlQUFZLENBQUUsT0FBTyxDQUFFLENBQUM7QUFDeEIsVUFBTyxHQUFHLFVBQVUsQ0FBRSxLQUFLLEVBQUUsSUFBSSxDQUFFLENBQUM7QUFDcEMsT0FBSyxPQUFPLEVBQUcsSUFBSSxDQUFDLEtBQUssQ0FBRSxPQUFPLEVBQUUsSUFBSSxDQUFFLENBQUM7R0FDM0MsQ0FBQztFQUNGOztBQUVELFFBQU87QUFDTixVQUFRLEVBQVIsUUFBUTtFQUNSLENBQUM7Q0FFRixDQUFFLENBQUMiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJGh0dHAnLCAnVE1EQl9BUEknLCAnRVZUJywgJyRjYWNoZUZhY3RvcnknLCAnJHEnLCAnRU5EUE9JTlRfVVJJJyxcclxuZnVuY3Rpb24gKCBsb2csICRodHRwLCBUTURCX0FQSSwgRVZULCAkY2FjaGVGYWN0b3J5LCAkcSwgRU5EUE9JTlRfVVJJICkge1xyXG5cclxuXHR2YXIgc2VhcmNoUmVzdWx0ID0gW107XHJcblx0dmFyIHByZXZSZXN1bHRMZW4gPSAwO1xyXG5cdHZhciB0b3RhbFBhZ2VzID0gLTE7XHJcblx0dmFyIGN1cnJQYWdlID0gMTtcclxuXHJcblx0dmFyIG1vdmllSWRDYWNoZSA9ICRjYWNoZUZhY3RvcnkoICdtb3ZpZUlkQ2FjaGUnICk7XHJcblx0Ly8gVE1EQl9BUEkudXJsICsgJ21vdmllL25vd19wbGF5aW5nJ1xyXG5cclxuXHR2YXIgREJfRU5EUE9JTlQgPSBFTkRQT0lOVF9VUkkgKyAnbW92aWUvJztcclxuXHJcblx0ZnVuY3Rpb24gcHV0SXRlbVRvREIoIG1vdmllSXRlbSApIHtcclxuXHRcdC8vIHRvZG8gZG9udCBwdXQgZXhpc2l0aW5nIGl0ZW0gaW4gZGIgKCBVUFNFUlQgKVxyXG5cdFx0JGh0dHAucHV0KCBEQl9FTkRQT0lOVCArIG1vdmllSXRlbS5pZCwgbW92aWVJdGVtIClcclxuXHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnaW5mbycsICdQVVQ6JywgcmVzICk7XHJcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ1BVVDonLCBlcnIgKTtcclxuXHRcdH0gKTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIHNlYXJjaElkRnJvbURCKCBpZCApIHtcclxuXHRcdHZhciBwcm9taXNlID0gJGh0dHAuZ2V0KCBEQl9FTkRQT0lOVCArIGlkIClcclxuXHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnaW5mbycsICdzZWFyY2hCeUlkID0+IERCOicsIHJlcy5kYXRhICk7XHJcblx0XHRcdGlmICggcmVzLmRhdGEgKSB7XHJcblx0XHRcdFx0bW92aWVJZENhY2hlLnB1dCggcmVzLmRhdGEuaWQsIHJlcy5kYXRhICk7XHJcblx0XHRcdFx0cmV0dXJuIHJlcy5kYXRhO1xyXG5cdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdHJldHVybiBudWxsO1xyXG5cdFx0XHR9XHJcblx0XHR9LCBmdW5jdGlvbiggZXJyICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdlcnInLCAnc2VhcmNoQnlJZCA9PiBEQjonLCBlcnIgKTtcclxuXHRcdH0gKTtcclxuXHRcdHJldHVybiBwcm9taXNlO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gc2VhcmNoSWRGcm9tQVBJKCBpZCApIHtcclxuXHRcdHZhciBwcm9taXNlID0gJGh0dHAuZ2V0KCBUTURCX0FQSS51cmwgKyAnbW92aWUvJyArIGlkLCB7XHJcblx0XHRcdHBhcmFtczogeyBhcGlfa2V5OiBUTURCX0FQSS5rZXkgfVxyXG5cdFx0fSApLnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdpbmZvJywgJ3NlYXJjaEJ5SWQgPT4gQVBJOicsIHJlcy5kYXRhICk7XHJcblx0XHRcdG1vdmllSWRDYWNoZS5wdXQoIHJlcy5kYXRhLmlkLCByZXMuZGF0YSApO1xyXG5cdFx0XHRwdXRJdGVtVG9EQiggcmVzLmRhdGEgKTtcclxuXHRcdFx0cmV0dXJuIHJlcy5kYXRhO1xyXG5cdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdzZWFyY2hCeUlkID0+IEFQSTonLCBlcnIgKTtcclxuXHRcdH0gKTtcclxuXHRcdHJldHVybiBwcm9taXNlO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gc2VhcmNoQnlJZCggaWQgKSB7XHJcblxyXG5cdFx0dmFyIGRmX0RCID0gJHEuZGVmZXIoKTtcclxuXHRcdHZhciBkZl9SZXMgPSAkcS5kZWZlcigpO1xyXG5cclxuXHRcdHZhciBjYWNoZWRJdGVtID0gbW92aWVJZENhY2hlLmdldCggaWQgKTtcclxuXHRcdGlmICggY2FjaGVkSXRlbSApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnaW5mbycsICdzZWFyY2hCeUlkID0+IGNhY2hlOicsIGNhY2hlZEl0ZW0gKTtcclxuXHRcdFx0ZGZfUmVzLnJlc29sdmUoIGNhY2hlZEl0ZW0gKTtcclxuXHRcdFx0cmV0dXJuIGRmX1Jlcy5wcm9taXNlO1xyXG5cdFx0fVxyXG5cclxuXHRcdHNlYXJjaElkRnJvbURCKCBpZCApLnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cdFx0XHRpZiAoIHJlcyApIHtcclxuXHRcdFx0XHRkZl9EQi5yZXNvbHZlKCByZXMgKTtcclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRkZl9EQi5yZWplY3QoICdub3QgZm91bmQnICk7XHJcblx0XHRcdH1cclxuXHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xyXG5cdFx0XHRcdGRmX0RCLnJlamVjdCggZXJyICk7XHJcblx0XHR9ICk7XHJcblxyXG5cdFx0ZGZfREIucHJvbWlzZS50aGVuKCBmdW5jdGlvbiAoIHJlc19EQiApIHtcclxuXHRcdFx0ZGZfUmVzLnJlc29sdmUoIHJlc19EQiApO1xyXG5cdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XHJcblx0XHRcdHNlYXJjaElkRnJvbUFQSSggaWQgKS50aGVuKCBmdW5jdGlvbiAoIHJlc19hcGkgKSB7XHJcblx0XHRcdFx0ZGZfUmVzLnJlc29sdmUoIHJlc19hcGkgKTtcclxuXHRcdFx0fSwgZnVuY3Rpb24gKCBlcnJfYXBpICkge1xyXG5cdFx0XHRcdGRmX1Jlcy5yZWplY3QoIGVycl9hcGkgKTtcclxuXHRcdFx0fSApO1xyXG5cdFx0fSApO1xyXG5cclxuXHRcdHJldHVybiBkZl9SZXMucHJvbWlzZTtcclxuXHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBzZWFyY2hCeVRpdGxlKCBzZWFyY2hPYmogKSB7XHJcblxyXG5cdFx0aWYgKCBjdXJyUGFnZSA+IHRvdGFsUGFnZXMgJiYgdG90YWxQYWdlcyAhPT0gLTEgKSB7XHJcblx0XHRcdC8vIGVtaXQgZXZlbnQgZW5kIG9mIHBhZ2VcclxuXHRcdFx0RVZULkVPUC5lbWl0KCk7XHJcblx0XHRcdHJldHVybjtcclxuXHRcdH1cclxuXHJcblx0XHQkaHR0cCgge1xyXG5cdFx0XHRtZXRob2Q6ICdHRVQnLFxyXG5cdFx0XHRjYWNoZTogdHJ1ZSxcclxuXHRcdFx0dXJsOiBUTURCX0FQSS51cmwgKyAnc2VhcmNoL21vdmllJyxcclxuXHRcdFx0cGFyYW1zOntcclxuXHRcdFx0XHRhcGlfa2V5OiBUTURCX0FQSS5rZXksXHJcblx0XHRcdFx0cXVlcnk6IHNlYXJjaE9iai5xdWVyeSxcclxuXHRcdFx0XHRwYWdlOiBjdXJyUGFnZVxyXG5cdFx0XHR9XHJcblx0XHR9ICkudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblx0XHRcdC8vIGVtaXQgZXZlbnQgc2VhcmNoIHN1Y2Nlc3NcclxuXHRcdFx0c2VhcmNoUmVzdWx0ID0gc2VhcmNoUmVzdWx0LmNvbmNhdCggcmVtb3ZlTm9Qb3N0ZXJJdGVtcyggcmVzLmRhdGEucmVzdWx0cyApICk7XHJcblx0XHRcdHRvdGFsUGFnZXMgPSByZXMuZGF0YS50b3RhbF9wYWdlcztcclxuXHRcdFx0Y3VyclBhZ2UgKys7XHJcblx0XHRcdHByZXZSZXN1bHRMZW4gPSBzZWFyY2hSZXN1bHQubGVuZ3RoO1xyXG5cdFx0XHRsb2cuZGVidWcoICdpbmZvJywgJ3NlYXJjaEJ5VGl0bGU6JywgcmVzLCByZXMuZGF0YSApO1xyXG5cclxuXHRcdFx0Ly8gY2FjaGVcclxuXHRcdFx0cmVzLmRhdGEucmVzdWx0cy5mb3JFYWNoKCBmdW5jdGlvbiAoIGl0ZW0gKSB7XHJcblxyXG5cdFx0XHRcdGlmICggIW1vdmllSWRDYWNoZS5nZXQoIGl0ZW0uaWQgKSApIHtcclxuXHRcdFx0XHRcdGNvbnNvbGUubG9nKCBpdGVtLmlkLCBpdGVtICk7XHJcblx0XHRcdFx0XHRtb3ZpZUlkQ2FjaGUucHV0KCBpdGVtLmlkLCBpdGVtICk7XHJcblx0XHRcdFx0XHQvLyBwdXRJdGVtVG9EQiggaXRlbSApO1xyXG5cdFx0XHRcdH1cclxuXHJcblx0XHRcdH0gKTtcclxuXHJcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0Ly8gZW1pdCBldmVudCBzZWFyY2ggZXJyXHJcblx0XHRcdGxvZy5kZWJ1ZyggJ3NlYXJjaEJ5VGl0bGU6JywgZXJyICk7XHJcblx0XHR9ICk7XHJcblxyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gcmVtb3ZlTm9Qb3N0ZXJJdGVtcyggcmVzdWx0cyApIHtcclxuXHRcdHJldHVybiByZXN1bHRzLmZpbHRlciggZnVuY3Rpb24gKCBpdGVtICkge1xyXG5cdFx0XHRyZXR1cm4gISFpdGVtLnBvc3Rlcl9wYXRoO1xyXG5cdFx0fSApO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gZ2V0UmVzKCkge1xyXG5cdFx0cmV0dXJuIHNlYXJjaFJlc3VsdDtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIGNsZWFyU2VhcmNoKCkge1xyXG5cdFx0Ly8gZW1pdCBldmVudCBjbGVhclNlYWNoXHJcblx0XHRzZWFyY2hSZXN1bHQubGVuZ3RoID0gMDtcclxuXHRcdHByZXZSZXN1bHRMZW4gPSAwO1xyXG5cdFx0dG90YWxQYWdlcyA9IC0xO1xyXG5cdFx0Y3VyclBhZ2UgPSAxO1xyXG5cdH1cclxuXHJcblx0cmV0dXJuIHtcclxuXHRcdHNlYXJjaEJ5VGl0bGUsXHJcblx0XHRzZWFyY2hCeUlkLFxyXG5cdFx0Y2xlYXJTZWFyY2gsXHJcblx0XHRnZXRSZXMsXHJcblx0XHRwcmV2UmVzdWx0TGVuLFxyXG5cdFx0cHV0SXRlbVRvREIsXHJcblx0XHRtb3ZpZUlkQ2FjaGVcclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdFTkRQT0lOVF9VUkknLCAnJGh0dHAnLCAnJHEnLCAnYXV0aFRva2VuJyxcbmZ1bmN0aW9uICggbG9nLCBFTkRQT0lOVF9VUkksICRodHRwLCAkcSwgYXV0aFRva2VuICkge1xuXG5cdFx0dmFyIGlkZW50aXR5ID0gbnVsbDtcblx0XHR2YXIgX2lkZW50aXR5UmVzb2x2ZWQgPSBmYWxzZTtcblxuXHRcdGZ1bmN0aW9uIGF1dGhvcml6ZSggZm9yY2UgKSB7XG5cblx0XHRcdHZhciBkZWZlcnJlZCA9ICRxLmRlZmVyKCk7XG5cblx0XHRcdGlmICggZm9yY2UgKSBpZGVudGl0eSA9IG51bGw7XG5cblx0XHRcdGlmICggaWRlbnRpdHkgIT09IG51bGwgKSB7XG5cblx0XHRcdFx0ZGVmZXJyZWQucmVzb2x2ZSggdHJ1ZSApO1xuXG5cdFx0XHR9IGVsc2Uge1xuXG5cdFx0XHRcdCRodHRwLmdldCggRU5EUE9JTlRfVVJJICsgJ2F1dGgnLCB7IHJlcXVpcmVBdXRoOiB0cnVlIH0gKVxuXHRcdFx0XHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcblxuXHRcdFx0XHRcdFx0bG9nLmRlYnVnKCAnaW5mbycsICdhdXRoLmF1dGhvcml6ZSgpOicsIHJlcywgcmVzLmRhdGEgKTtcblx0XHRcdFx0XHRcdGlkZW50aXR5ID0gcmVzLmRhdGE7XG5cdFx0XHRcdFx0XHRfaWRlbnRpdHlSZXNvbHZlZCA9IHRydWU7XG5cdFx0XHRcdFx0XHRkZWZlcnJlZC5yZXNvbHZlKCB0cnVlICk7XG5cblx0XHRcdFx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcblxuXHRcdFx0XHRcdFx0bG9nLmRlYnVnKCAnd2FybicsICdhdXRob3JpemUnLCBlcnIsIGVyci5kYXRhICk7XG5cdFx0XHRcdFx0XHQvLyB0b2RvIGlmIGp3dCBleHBpcmVkICwgZGVhdXRob3JpemUsIHJlbW92ZSBsb2NhbCBzdG9yYWdlLCByZWRpcmVjdFxuXHRcdFx0XHRcdFx0X2lkZW50aXR5UmVzb2x2ZWQgPSB0cnVlO1xuXHRcdFx0XHRcdFx0ZGVmZXJyZWQucmVqZWN0KCBlcnIgKTtcblxuXHRcdFx0XHRcdH0gKTtcblxuXHRcdFx0fVxuXG5cdFx0XHRyZXR1cm4gZGVmZXJyZWQucHJvbWlzZTtcblxuXHRcdH1cblxuXHRcdGZ1bmN0aW9uIGRlYXV0aG9yaXplKCkge1xuXHRcdFx0YXV0aFRva2VuLnJlbW92ZVRva2VuKCk7XG5cdFx0XHRpZGVudGl0eSA9IG51bGw7XG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gaXNBdXRoZW50aWNhdGVkKCkge1xuXHRcdFx0cmV0dXJuIGlkZW50aXR5ICE9PSBudWxsO1xuXHRcdH1cblxuXHRcdGZ1bmN0aW9uIGlkZW50aXR5UmVzb2x2ZWQoKSB7XG5cdFx0XHRyZXR1cm4gX2lkZW50aXR5UmVzb2x2ZWQ7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHtcblxuXHRcdFx0YXV0aG9yaXplLFxuXHRcdFx0ZGVhdXRob3JpemUsXG5cdFx0XHRpc0F1dGhlbnRpY2F0ZWQsXG5cdFx0XHRpZGVudGl0eVJlc29sdmVkXG5cblx0XHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2F1dGhUb2tlbicsIGZ1bmN0aW9uICggYXV0aFRva2VuICkge1xuXG5cdGZ1bmN0aW9uIHJlcXVlc3QoIGNvbmZpZyApIHtcblxuXHRcdGlmICggY29uZmlnLnJlcXVpcmVBdXRoICkge1xuXHRcdFx0dmFyIHRva2VuID0gYXV0aFRva2VuLmdldFRva2VuKCk7XG5cdFx0XHRpZiAoIHRva2VuICkge1xuXHRcdFx0XHQvLyBodHRwOi8vc2VsZi1pc3N1ZWQuaW5mby9kb2NzL2RyYWZ0LWlldGYtb2F1dGgtdjItYmVhcmVyLmh0bWwgICBzZWN0aW9uIDIuMVxuXHRcdFx0XHQvLyBodHRwczovL2RldmVsb3BlcnMuZ29vZ2xlLmNvbS9nbWFpbC9tYXJrdXAvYWN0aW9ucy92ZXJpZnlpbmctYmVhcmVyLXRva2Vuc1xuXHRcdFx0XHQvLyBodHRwOi8vd3d3LnczLm9yZy9Qcm90b2NvbHMvcmZjMjYxNi9yZmMyNjE2LXNlYzQuaHRtbCBzZWN0aW9uIDQuMiBoZWFkZXIgZmllbGQgbmFtZSBjYXNlIGluc2Vuc2l0aXZlXG5cdFx0XHRcdGNvbmZpZy5oZWFkZXJzLkF1dGhvcml6YXRpb24gPSAnQmVhcmVyICcgKyB0b2tlbjtcblx0XHRcdH1cblx0XHR9XG5cblx0XHRyZXR1cm4gY29uZmlnO1xuXG5cdH1cblxuXHRmdW5jdGlvbiByZXNwb25zZSggcmVzICkge1xuXHRcdHJldHVybiByZXM7XG5cdH1cblxuXHRyZXR1cm4ge1xuXG5cdFx0cmVxdWVzdCxcblx0XHRyZXNwb25zZVxuXG5cdH07XG5cbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHdpbmRvdycsIGZ1bmN0aW9uICggbG9nLCAkd2luZG93ICkge1xuXG5cdHZhciBzdG9yYWdlID0gJHdpbmRvdy5sb2NhbFN0b3JhZ2U7XG5cdHZhciBjYWNoZWRUb2tlbiA9IG51bGw7XG5cblx0ZnVuY3Rpb24gc2V0VG9rZW4oIHRva2VuICkge1xuXHRcdGNhY2hlZFRva2VuID0gdG9rZW47XG5cdFx0c3RvcmFnZS5zZXRJdGVtKCAnand0JywgdG9rZW4gKTtcblx0fVxuXG5cdGZ1bmN0aW9uIGdldFRva2VuKCkge1xuXHRcdGlmICggIWNhY2hlZFRva2VuICkge1xuXHRcdFx0Y2FjaGVkVG9rZW4gPSBzdG9yYWdlLmdldEl0ZW0oICdqd3QnICk7XG5cdFx0fVxuXHRcdHJldHVybiBjYWNoZWRUb2tlbjtcblx0fVxuXG5cdGZ1bmN0aW9uIHJlbW92ZVRva2VuKCkge1xuXHRcdGNhY2hlZFRva2VuID0gbnVsbDtcblx0XHRzdG9yYWdlLnJlbW92ZUl0ZW0oICdqd3QnICk7XG5cdFx0bG9nLmRlYnVnKCAnaW5mbycsICd0b2tlbiByZW1vdmVkJyApO1xuXHR9XG5cblx0ZnVuY3Rpb24gaGFzVG9rZW4oKSB7XG5cdFx0cmV0dXJuICEhZ2V0VG9rZW4oKTtcblx0fVxuXG5cdHJldHVybiB7XG5cblx0XHRzZXRUb2tlbixcblx0XHRnZXRUb2tlbixcblx0XHRyZW1vdmVUb2tlbixcblx0XHRoYXNUb2tlblxuXG5cdH07XG5cbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJ2F1dGgnLCAnbW92aWVDb2xsZWN0aW9uJywgZnVuY3Rpb24gKCBsb2csICRzY29wZSwgYXV0aCwgbW92aWVDb2xsZWN0aW9uICkgIHtcclxuXHJcblx0d2luZG93Lm1vdmllQ29sbGVjdGlvbiA9IG1vdmllQ29sbGVjdGlvbjtcclxuXHRsb2cuZGVidWcoICdpbmZvJywgJ2NvbGxlY3Rpb25DdHJsJywgbW92aWVDb2xsZWN0aW9uLmdldENvbGxlY3Rpb24oKSApO1xyXG5cdHZhciB2bSA9IHRoaXM7XHJcblx0dm0ubW92aWVDb2xsZWN0aW9uID0gbW92aWVDb2xsZWN0aW9uO1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckc2NvcGUnLCAnJGh0dHAnLCAnRU5EUE9JTlRfVVJJJywgJ2F1dGhUb2tlbicsICckc3RhdGUnLFxyXG5mdW5jdGlvbiAoIGxvZywgJHNjb3BlLCAkaHR0cCwgRU5EUE9JTlRfVVJJLCBhdXRoVG9rZW4sICRzdGF0ZSApICB7XHJcblxyXG5cdHZhciB2bSA9IHRoaXM7XHJcblx0dm0udXNlciA9IHtcclxuXHRcdGVtYWlsOiAnJyxcclxuXHRcdHBhc3N3b3JkOiAnJ1xyXG5cdH07XHJcblxyXG5cdHZtLnNpZ25pbiA9IGZ1bmN0aW9uKCkge1xyXG5cclxuXHRcdGlmICggdm0udXNlci5lbWFpbCA9PT0gJycgfHwgdm0udXNlci5wYXNzd29yZCA9PT0gJycgKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ3dhcm4nLCAnZW1haWwgJiBwYXNzd29yZCByZXF1aXJlZC4nICk7XHJcblx0XHRcdHJldHVybjtcclxuXHRcdH1cclxuXHJcblx0XHQkaHR0cC5wb3N0KCBFTkRQT0lOVF9VUkkgKyAnc2lnbmluJywgdm0udXNlciApXHJcblx0XHRcdC50aGVuKCBmdW5jdGlvbiggcmVzICkge1xyXG5cdFx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnc2lnbmluJywgcmVzLCByZXMuZGF0YSApO1xyXG5cdFx0XHRcdGF1dGhUb2tlbi5zZXRUb2tlbiggcmVzLmRhdGEudG9rZW4gKTtcclxuXHRcdFx0XHQkc3RhdGUuZ28oICdjb2xsZWN0aW9uJyApO1xyXG5cdFx0XHR9LCBmdW5jdGlvbiggZXJyLCBzdGF0dXMgKSB7XHJcblx0XHRcdFx0bG9nLmRlYnVnKCAnd2FybicsICdzaWduaW4nLCBlcnIgKTtcclxuXHRcdFx0fSApO1xyXG5cclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyRzdGF0ZScsICdhdXRoJywgJ21vdmllQ29sbGVjdGlvbicsIGZ1bmN0aW9uICggJHN0YXRlLCBhdXRoLCBtb3ZpZUNvbGxlY3Rpb24gKSAge1xyXG5cclxuXHRhdXRoLmRlYXV0aG9yaXplKCk7XHJcblx0bW92aWVDb2xsZWN0aW9uLl9jbGVhcigpO1xyXG5cdCRzdGF0ZS5nbyggJ3NpZ25pbicgKTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJyRodHRwJywgJ0VORFBPSU5UX1VSSScsICdhdXRoVG9rZW4nLCAnJHN0YXRlJyxcbmZ1bmN0aW9uICggbG9nLCAkc2NvcGUsICRodHRwLCBFTkRQT0lOVF9VUkksIGF1dGhUb2tlbiwgJHN0YXRlICkge1xuXG5cdFx0dmFyIHZtID0gdGhpcztcblx0XHR2bS51c2VyID0ge307XG5cblx0XHR2bS5zaWdudXAgPSBmdW5jdGlvbiAoKSB7XHJcblxuXHRcdFx0aWYgKCB2bS51c2VyLmVtYWlsID09PSB1bmRlZmluZWQgfHwgdm0udXNlci5wYXNzd29yZCA9PT0gdW5kZWZpbmVkICkge1xuXHRcdFx0XHRsb2cuZGVidWcoICd3YXJuJywgJ2VtYWlsICYgcGFzc3dvcmQgcmVxdWlyZWQuJyApO1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cblx0XHRcdGxvZy5kZWJ1ZyggJ3dhcm4nLCAnc2lnbmluZyB1cC4uLicgKTtcclxuXHRcdFx0JGh0dHAucG9zdCggRU5EUE9JTlRfVVJJICsgJ3NpZ251cCcsIHZtLnVzZXIgKVxyXG5cdFx0XHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcclxuXG5cdFx0XHRcdFx0bG9nLmRlYnVnKCAnaW5mbycsICdSZWdpc3RlcmVkLicgKTtcclxuXHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCByZXMgKTtcclxuXHJcblx0XHRcdFx0XHRhdXRoVG9rZW4uc2V0VG9rZW4oIHJlcy5kYXRhLnRva2VuICk7XHJcblx0XHRcdFx0XHQkc3RhdGUuZ28oICdjb2xsZWN0aW9uJyApO1xyXG5cblx0XHRcdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XHJcblxuXHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ3dhcm4nLCBlcnIgKTtcblx0XHRcdFx0XHR2bS5mb3JtLiRzdWJtaXR0ZWQgPSBmYWxzZTtcclxuXG5cdFx0XHRcdH0gKTtcclxuXG5cdFx0fTtcblxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdUTURiJywgZnVuY3Rpb24gKCBsb2csIFRNRGIgKSB7XHJcblxyXG5cdGZ1bmN0aW9uIGN0cmwoICRzY29wZSwgJGF0dHJzLCAkZWxlbWVudCApIHtcclxuXHJcblx0XHRUTURiLnNlYXJjaEJ5SWQoIHBhcnNlSW50KCAkc2NvcGUubW92aWVJZCApIClcclxuXHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcclxuXHJcblx0XHRcdC8vIGxvZy5kZWJ1ZyggJ2luZm8nLCAnY29sbGVjdGlvbkl0ZW1EaXJlY3RpdmUnLCByZXMgKTtcclxuXHRcdFx0dmFyIGltZ1VybCA9ICdodHRwOi8vaW1hZ2UudG1kYi5vcmcvdC9wL3cxNTQvJyArIHJlcy5wb3N0ZXJfcGF0aDtcclxuXHRcdFx0JGVsZW1lbnQuY3NzKCB7XHJcblx0XHRcdFx0J3dpZHRoJzogJzUwcHgnLFxyXG5cdFx0XHRcdCdoZWlnaHQnOiAnNzBweCcsXHJcblx0XHRcdFx0J2JhY2tncm91bmQtcmVwZWF0JzogJ25vLXJlcGVhdCcsXHJcblx0XHRcdFx0J2JhY2tncm91bmQtc2l6ZSc6ICc1MHB4IDcwcHgnLFxyXG5cdFx0XHRcdCdiYWNrZ3JvdW5kLWltYWdlJzogJ3VybCgnICsgaW1nVXJsICsgJyknXHJcblx0XHRcdH0gKTtcclxuXHJcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ2NvbGxlY3Rpb25JdGVtRGlyZWN0aXZlJywgZXJyICk7XHJcblx0XHR9ICk7XHJcblxyXG5cdH1cclxuXHJcblx0cmV0dXJuIHtcclxuXHRcdHJlc3RyaWN0OiAnRScsXHJcblx0XHRyZXBsYWNlOiB0cnVlLFxyXG5cdFx0c2NvcGU6IHsgbW92aWVJZDogJ0AnIH0sXHJcblx0XHRjb250cm9sbGVyOiBjdHJsLFxyXG5cdFx0Y29udHJvbGxlckFzOiAnY2knLFxyXG5cdFx0dGVtcGxhdGU6ICc8ZGl2PjwvZGl2PidcclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdtb3ZpZUNvbGxlY3Rpb24nLCAnY29sbGVjdGlvbk1vZGFsU2VydmljZScsICdFVlQnLFxyXG5mdW5jdGlvbiAoIGxvZywgbW92aWVDb2xsZWN0aW9uLCBjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLCBFVlQgKSB7XHJcblxyXG5cdGZ1bmN0aW9uIGN0cmwoICRzY29wZSwgJGVsZW1lbnQsICRhdHRycyApIHtcclxuXHJcblx0XHR2YXIgdm0gPSB0aGlzO1xyXG5cdFx0dm0ubW92aWVDb2xsZWN0aW9uID0gbW92aWVDb2xsZWN0aW9uO1xyXG5cdFx0dm0uY29sbGVjdGlvbk1vZGFsU2VydmljZSA9IGNvbGxlY3Rpb25Nb2RhbFNlcnZpY2U7XHJcblxyXG5cdFx0dm0uYWRkaW5nTmV3Q29sbGVjdGlvbiA9IGZhbHNlO1xyXG5cclxuXHRcdHZtLm9wZW5FZGl0b3IgPSBmdW5jdGlvbiAoKSB7XHJcblx0XHRcdHZtLmFkZGluZ05ld0NvbGxlY3Rpb24gPSB0cnVlO1xyXG5cdFx0fTtcclxuXHJcblx0XHR2bS5jbG9zZUVkaXRvciA9IGZ1bmN0aW9uICgpIHtcclxuXHRcdFx0dm0uYWRkaW5nTmV3Q29sbGVjdGlvbiA9IGZhbHNlO1xyXG5cdFx0fTtcclxuXHJcblx0XHR2bS5jcmVhdGVOZXdDb2xsZWN0aW9uID0gZnVuY3Rpb24gKCkge1xyXG5cdFx0XHRtb3ZpZUNvbGxlY3Rpb24uY3JlYXRlKCAkc2NvcGUubmV3Q29sbGVjdGlvbk5hbWUgKTtcclxuXHRcdFx0dm0uY2xvc2VFZGl0b3IoKTtcclxuXHRcdH07XHJcblxyXG5cdFx0dm0uYWRkVG9Db2xsZWN0aW9uID0gZnVuY3Rpb24gKCBtb3ZpZUlkLCBjb2xsZWN0aW9uTmFtZSApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnaW5mbycsICdhZGRUb0NvbGxlY3Rpb246JywgbW92aWVJZCwgY29sbGVjdGlvbk5hbWUgKTtcclxuXHRcdFx0dmFyIHN1Y2Nlc3MgPSBtb3ZpZUNvbGxlY3Rpb24ucHVzaCggbW92aWVJZCwgY29sbGVjdGlvbk5hbWUgKTtcclxuXHRcdFx0bG9nLmRlYnVnKCAnaW5mbycsICdtb3ZpZUNvbGxlY3Rpb24ucHVzaCcsIHN1Y2Nlc3MgKTtcclxuXHRcdH07XHJcblxyXG5cdFx0Ly8gZGVmYXVsdCBjc3MgYXQgZGlyZWN0aXZlIGluaXRpYWxpemF0aW9uXHJcblx0XHQkZWxlbWVudC5jc3MoIHsgdmlzaWJpbGl0eTogJ2hpZGRlbicgfSApO1xyXG5cclxuXHRcdEVWVC5jb2xsZWN0aW9uTW9kYWxPcGVuLmxpc3RlbiggZnVuY3Rpb24gKCkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdpbmZvJywgJ2NvbGxlY3Rpb25Nb2RhbE9wZW4nICk7XHJcblx0XHQkZWxlbWVudC5jc3MoIHsgdmlzaWJpbGl0eTogJ3Zpc2libGUnIH0gKTtcclxuXHRcdH0gKTtcclxuXHJcblx0XHRFVlQuY29sbGVjdGlvbk1vZGFsQ2xvc2UubGlzdGVuKCBmdW5jdGlvbiAoKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnY29sbGVjdGlvbk1vZGFsQ2xvc2UnICk7XHJcblx0XHQkZWxlbWVudC5jc3MoIHsgdmlzaWJpbGl0eTogJ2hpZGRlbicgfSApO1xyXG5cdFx0fSApO1xyXG5cclxuXHR9XHJcblxyXG5cdHJldHVybiB7XHJcblxyXG5cdFx0cmVzdHJpY3Q6ICdFJyxcclxuXHRcdHNjb3BlOiB7fSxcclxuXHRcdGNvbnRyb2xsZXI6IGN0cmwsXHJcblx0XHRjb250cm9sbGVyQXM6ICdtb2RhbCcsXHJcblx0XHRyZXBsYWNlOiB0cnVlLFxyXG5cdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL2NvbGxlY3Rpb25Nb2RhbC5odG1sJ1xyXG5cclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdFVlQnLCBmdW5jdGlvbiAoIGxvZywgRVZUICkge1xyXG5cclxuXHR2YXIgYWN0aXZlSXRlbSA9IG51bGw7XHJcblxyXG5cdGZ1bmN0aW9uIHNldEFjdGl2ZUl0ZW0oIGl0ZW0gKSB7XHJcblx0XHRhY3RpdmVJdGVtID0gaXRlbTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIGdldEFjdGl2ZUl0ZW0oIGl0ZW0gKSB7XHJcblx0XHRyZXR1cm4gYWN0aXZlSXRlbTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIG9wZW4oKSB7XHJcblx0XHRFVlQuY29sbGVjdGlvbk1vZGFsT3Blbi5lbWl0KCk7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBjbG9zZSgpIHtcclxuXHRcdEVWVC5jb2xsZWN0aW9uTW9kYWxDbG9zZS5lbWl0KCk7XHJcblx0fVxyXG5cclxuXHRyZXR1cm4ge1xyXG5cdFx0c2V0QWN0aXZlSXRlbSxcclxuXHRcdGdldEFjdGl2ZUl0ZW0sXHJcblx0XHRvcGVuLFxyXG5cdFx0Y2xvc2VcclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgZnVuY3Rpb24gKCkge1xuXG5cdHZhciBkZWJ1Z0VuYWJsZWQgPSBmYWxzZTtcblx0dmFyIGRlYnVnTmFtZXNwYWNlcyA9IFtdO1xuXG5cdHRoaXMuZW5hYmxlRGVidWcgPSBmdW5jdGlvbiAoKSB7XG5cdFx0ZGVidWdFbmFibGVkID0gdHJ1ZTtcblx0fTtcblxuXHR0aGlzLmVuYWJsZURlYnVnTmFtZXNwYWNlID0gZnVuY3Rpb24gKCkge1xuXHRcdGZvciAoIGxldCBpID0gMDsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7IGkrKyApIHtcblx0XHRcdGRlYnVnTmFtZXNwYWNlcy5wdXNoKCBhcmd1bWVudHNbIGkgXSApO1xuXHRcdH1cblx0fTtcblxuXHR0aGlzLiRnZXQgPSAoKSA9PiB7XG5cblx0XHRmdW5jdGlvbiBkZWJ1ZygpIHtcblx0XHRcdGlmICggIWRlYnVnRW5hYmxlZCApIHJldHVybjtcclxuXHRcdFx0dmFyIGRlYnVnTmFtZSA9IGFyZ3VtZW50c1sgMCBdO1xyXG5cdFx0XHR2YXIgc2xpY2VkQXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKCBhcmd1bWVudHMsIDEgKTtcclxuXHRcdFx0aWYgKCBkZWJ1Z05hbWUgPT09ICdlcnInICkge1xyXG5cdFx0XHRcdGNvbnNvbGUuZXJyb3IuYXBwbHkoIGNvbnNvbGUsIHNsaWNlZEFyZ3MgKTtcclxuXHRcdFx0fSBlbHNlIGlmICggZGVidWdOYW1lID09PSAnaW5mbycgKSB7XHJcblx0XHRcdFx0Y29uc29sZS5pbmZvLmFwcGx5KCBjb25zb2xlLCBzbGljZWRBcmdzICk7XHJcblx0XHRcdH0gZWxzZSBpZiAoIGRlYnVnTmFtZSA9PT0gJ3dhcm4nICkge1xyXG5cdFx0XHRcdGNvbnNvbGUud2Fybi5hcHBseSggY29uc29sZSwgc2xpY2VkQXJncyApO1xyXG5cdFx0XHR9IGVsc2UgaWYgKCBkZWJ1Z05hbWVzcGFjZXMuaW5kZXhPZiggZGVidWdOYW1lICkgIT09IC0xICkge1xyXG5cdFx0XHRcdGNvbnNvbGUubG9nLmFwcGx5KCBjb25zb2xlLCBzbGljZWRBcmdzICk7XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHtcblx0XHRcdGRlYnVnXG5cdFx0fTtcblxuXHR9O1xuXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJHJvb3RTY29wZScsIGZ1bmN0aW9uICggJHJvb3RTY29wZSApIHtcclxuXHJcblx0dmFyIEVWVCA9IHtcclxuXHJcblx0XHRFT1A6IHtcclxuXHRcdFx0bGlzdGVuOiBmdW5jdGlvbiAoIGNiICkgeyAkcm9vdFNjb3BlLiRvbiggJ0VPUCcsIGNiICk7IH0sXHJcblx0XHRcdGVtaXQ6IGZ1bmN0aW9uICgpIHsgJHJvb3RTY29wZS4kYnJvYWRjYXN0KCAnRU9QJyApOyB9XHJcblx0XHR9LFxyXG5cdFx0Y29sbGVjdGlvbk1vZGFsT3Blbjoge1xyXG5cdFx0XHRsaXN0ZW46IGZ1bmN0aW9uICggY2IgKSB7ICRyb290U2NvcGUuJG9uKCAnY29sbGVjdGlvbk1vZGFsT3BlbicsIGNiICk7IH0sXHJcblx0XHRcdGVtaXQ6IGZ1bmN0aW9uICgpIHsgJHJvb3RTY29wZS4kYnJvYWRjYXN0KCAnY29sbGVjdGlvbk1vZGFsT3BlbicgKTsgfVxyXG5cdFx0fSxcclxuXHRcdGNvbGxlY3Rpb25Nb2RhbENsb3NlOiB7XHJcblx0XHRcdGxpc3RlbjogZnVuY3Rpb24gKCBjYiApIHsgJHJvb3RTY29wZS4kb24oICdjb2xsZWN0aW9uTW9kYWxDbG9zZScsIGNiICk7IH0sXHJcblx0XHRcdGVtaXQ6IGZ1bmN0aW9uICgpIHsgJHJvb3RTY29wZS4kYnJvYWRjYXN0KCAnY29sbGVjdGlvbk1vZGFsQ2xvc2UnICk7IH1cclxuXHRcdH1cclxuXHJcblx0fTtcclxuXHJcblx0cmV0dXJuIEVWVDtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckd2luZG93JywgJ0VOR0lORScsICd1dGlsJywgZnVuY3Rpb24gKCAkd2luZG93LCBFTkdJTkUsIHV0aWwgKSB7XG5cblx0ZnVuY3Rpb24gY3RybCggJHNjb3BlLCAkZWxlbWVudCApIHtcblxuXHRcdEVOR0lORS5hdHRhY2hSZW5kZXJlciggJGVsZW1lbnQgKTtcclxuXHRcdCQoICR3aW5kb3cgKS5vbiggJ3Jlc2l6ZScsIHV0aWwuZGVib3VuY2UoIEVOR0lORS5vbldpbmRvd1Jlc2l6ZSwgMTAwICkgKTtcclxuXHRcdCRlbGVtZW50Lm9uKCAnd2hlZWwnLCBmdW5jdGlvbiAoIGV2dCApIHtcblx0XHRcdEVOR0lORS4kJC53aGVlbF9keSA9IC1NYXRoLnNpZ24oIGV2dC5vcmlnaW5hbEV2ZW50LmRlbHRhWSApO1xuXHRcdH0gKTtcblxyXG5cdFx0RU5HSU5FLnN0YXJ0KCk7XG5cblx0fVxuXG5cdHJldHVybiB7XG5cdFx0cmVzdHJpY3Q6ICdFJyxcblx0XHRyZXBsYWNlOiB0cnVlLFxuXHRcdGNvbnRyb2xsZXI6IGN0cmwsXG5cdFx0dGVtcGxhdGU6ICc8ZGl2IGlkPVwiY2FudmFzLWNvbnRhaW5lclwiPjwvZGl2Pidcblx0fTtcblxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyR3aW5kb3cnLCBmdW5jdGlvbiAoICR3aW5kb3cgKSB7XG5cblx0dmFyICQkID0ge1xuXHRcdGNhbnZhczogbnVsbCxcblx0XHRzdGF0czogbmV3IFN0YXRzKCksXG5cdFx0c2NlbmU6IG5ldyBUSFJFRS5TY2VuZSgpLFxuXHRcdHdpZHRoOiAkKHdpbmRvdykud2lkdGgoKSxcblx0XHRoZWlnaHQ6ICQod2luZG93KS5oZWlnaHQoKSxcblx0XHRjYW1lcmE6IG5ldyBUSFJFRS5QZXJzcGVjdGl2ZUNhbWVyYSggNzAsIHRoaXMud2lkdGggLyB0aGlzLmhlaWdodCwgMTAsIDEwMDAwMCApLFxuXHRcdHJlbmRlcmVyOiBuZXcgVEhSRUUuQ1NTM0RSZW5kZXJlcigpLFxuXHRcdHNjcmVlbl9yYXRpbzogdGhpcy53aWR0aCAvIHRoaXMuaGVpZ2h0LFxuXHRcdHBpeGVsX3JhdGlvOiAkd2luZG93LmRldmljZVBpeGVsUmF0aW8gfHwgMSxcblx0XHRtb3VzZV94OiB0aGlzLndpZHRoICogMC41LFxuXHRcdG1vdXNlX3k6IHRoaXMuaGVpZ2h0ICogMC41LFxuXHRcdHdoZWVsX2R5OiAwXG5cdH07XG5cblx0JCQucmVuZGVyZXIuc2V0U2l6ZSggJCQud2lkdGgsICQkLmhlaWdodCApO1xuXG5cdGZ1bmN0aW9uIGF0dGFjaFJlbmRlcmVyKCBjYW52YXMgKSB7XG5cdFx0JCQuY2FudmFzID0gY2FudmFzO1xuXHRcdGNhbnZhcy5hcHBlbmQoICQkLnJlbmRlcmVyLmRvbUVsZW1lbnQgKTtcblx0XHRjYW52YXMuYXBwZW5kKCAkJC5zdGF0cy5kb21FbGVtZW50ICk7XG5cdH1cblxuXHRmdW5jdGlvbiBvbldpbmRvd1Jlc2l6ZSgpIHtcblx0XHQkJC53aWR0aCA9ICQod2luZG93KS53aWR0aCgpO1xuXHRcdCQkLmhlaWdodCA9ICQod2luZG93KS5oZWlnaHQoKTtcblx0XHQkJC5waXhlbF9yYXRpbyA9ICR3aW5kb3cuZGV2aWNlUGl4ZWxSYXRpbyB8fCAxO1xuXHRcdCQkLnNjcmVlbl9yYXRpbyA9ICQkLndpZHRoIC8gJCQuaGVpZ2h0O1xuXHRcdCQkLmNhbWVyYS5hc3BlY3QgPSAkJC5zY3JlZW5fcmF0aW87XG5cdFx0JCQuY2FtZXJhLnVwZGF0ZVByb2plY3Rpb25NYXRyaXgoKTtcblx0XHQkJC5yZW5kZXJlci5zZXRTaXplKCAkJC53aWR0aCwgJCQuaGVpZ2h0ICk7XG5cdH1cblxuXHRmdW5jdGlvbiBzZXR1cCgpIHtcblxuXHR9XG5cblx0ZnVuY3Rpb24gdXBkYXRlKCkge1xuXG5cdFx0aWYgKCBNYXRoLmFicyggJCQud2hlZWxfZHkgKSA+IDAuMDAxICkge1xuXHRcdFx0JCQuY2FtZXJhLnBvc2l0aW9uLnkgKz0gJCQud2hlZWxfZHkgKiAxLjA7XG5cdFx0XHQkJC5jYW1lcmEucm90YXRlWSggJCQud2hlZWxfZHkgKiAwLjAyNSApO1xuXHRcdFx0JCQud2hlZWxfZHkgKj0gMC45NTtcblx0XHR9XG5cblx0fVxuXG5cdC8vIC0tLS0gIGRyYXcgbG9vcFxuXHRmdW5jdGlvbiBydW4oKSB7XG5cblx0XHRyZXF1ZXN0QW5pbWF0aW9uRnJhbWUoIHJ1biApO1xuXHRcdHVwZGF0ZSgpO1xuXHRcdCQkLnJlbmRlcmVyLnJlbmRlciggJCQuc2NlbmUsICQkLmNhbWVyYSApO1xuXHRcdCQkLnN0YXRzLnVwZGF0ZSgpO1xuXG5cdH1cblxuXHRmdW5jdGlvbiBzdGFydCgpIHtcblx0XHRzZXR1cCgpO1xuXHRcdHJ1bigpO1xuXHR9XG5cblx0ZnVuY3Rpb24gcmVzZXRDYW1lcmEoKSB7XG5cdFx0JCQuY2FtZXJhLnBvc2l0aW9uLnNldCggMCwgMCwgMCApO1xuXHRcdCQkLmNhbWVyYS5yb3RhdGlvbi5zZXQoIDAsIDAsIDAgKTtcblx0fVxuXG5cdHJldHVybiB7XG5cdFx0JCQsXG5cdFx0YXR0YWNoUmVuZGVyZXIsXG5cdFx0b25XaW5kb3dSZXNpemUsXG5cdFx0c3RhcnQsXG5cdFx0cmVzZXRDYW1lcmEsXG5cdH07XG5cbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnRU5HSU5FJywgJyRjb21waWxlJywgJyRyb290U2NvcGUnLFxyXG5mdW5jdGlvbiAoIGxvZywgRU5HSU5FLCAkY29tcGlsZSwgJHJvb3RTY29wZSApIHtcclxuXG5cdHZhciBhbGxQb3N0ZXJzID0gbmV3IFRIUkVFLk9iamVjdDNEKCk7XG5cdEVOR0lORS4kJC5zY2VuZS5hZGQoIGFsbFBvc3RlcnMgKTtcblxuXHRmdW5jdGlvbiBtYWtlSGVsaXhQb3N0ZXJzKCBwb3N0ZXJPYmplY3RNdWx0aSwgb2Zmc2V0U3RhcnRJZHggKSB7XG5cclxuXHRcdHZhciB2ZWN0b3IgPSBuZXcgVEhSRUUuVmVjdG9yMygpO1xyXG5cdFx0dmFyIHJhZGl1cyA9IDkwMDtcclxuXHRcdGZvciAoIHZhciBpID0gMDsgaSA8IHBvc3Rlck9iamVjdE11bHRpLmxlbmd0aDsgaSsrICkge1xuXG5cdFx0XHR2YXIgJGlzb2xhdGVkU2NvcGUgPSAkcm9vdFNjb3BlLiRuZXcoIHRydWUgKTtcblx0XHRcdCRpc29sYXRlZFNjb3BlLm1vdmllSXRlbSA9IHBvc3Rlck9iamVjdE11bHRpWyBpIF07XHJcblxyXG5cdFx0XHR2YXIgcG9zdGVyRGlyZWN0aXZlRWxlbSA9ICRjb21waWxlKCAnPHBvc3Rlcj48L3Bvc3Rlcj4nICkoICRpc29sYXRlZFNjb3BlIClbIDAgXTtcblx0XHRcdHZhciBjc3MzZE9iaiA9IG5ldyBUSFJFRS5DU1MzRE9iamVjdCggcG9zdGVyRGlyZWN0aXZlRWxlbSApO1xyXG5cclxuXHRcdFx0Ly8gdGFnIGFsb2cgYW4gaXNvbGF0ZWRTY29wZSB0byBiZSBkZXN0cm95IHdoZW4gZGlzcG9zZSBhbiBlbGVtZW50XHJcblx0XHRcdGNzczNkT2JqLnNjb3BlID0gJGlzb2xhdGVkU2NvcGU7XHJcblxyXG5cdFx0XHR2YXIgaGlkeCA9IGkgKyBvZmZzZXRTdGFydElkeDtcblx0XHRcdHZhciBwaGkgPSBoaWR4ICogMC4xNzUgKyBNYXRoLlBJO1xyXG5cdFx0XHRjc3MzZE9iai5wb3NpdGlvbi54ID0gLSByYWRpdXMgKiBNYXRoLnNpbiggcGhpICk7XHJcblx0XHRcdGNzczNkT2JqLnBvc2l0aW9uLnkgPSAtICggaGlkeCAqIDggKSArIDIwMDtcclxuXHRcdFx0Y3NzM2RPYmoucG9zaXRpb24ueiA9IHJhZGl1cyAqIE1hdGguY29zKCBwaGkgKTtcclxuXHJcblx0XHRcdHZlY3Rvci5zZXQoIC1jc3MzZE9iai5wb3NpdGlvbi54ICogMiwgY3NzM2RPYmoucG9zaXRpb24ueSwgLWNzczNkT2JqLnBvc2l0aW9uLnogKiAyICk7XHJcblxuXHRcdFx0Y3NzM2RPYmoubG9va0F0KCB2ZWN0b3IgKTtcclxuXHRcdFx0YWxsUG9zdGVycy5hZGQoIGNzczNkT2JqICk7XG5cblx0XHR9XG5cblx0XHRsb2cuZGVidWcoICdpbmZvJywgJ2N1cnIgcG9zdGVyczonLCBhbGxQb3N0ZXJzLmNoaWxkcmVuLmxlbmd0aCApO1xyXG5cclxuXHR9XG5cblx0ZnVuY3Rpb24gY2xlYXJBbGwoKSB7XHJcblx0XHRhbGxQb3N0ZXJzLmNoaWxkcmVuLmZvckVhY2goIGZ1bmN0aW9uICggcG9zdGVyICkge1xyXG5cdFx0XHRwb3N0ZXIuZGlzcG9zZUVsZW1lbnQoKTtcclxuXHRcdFx0cG9zdGVyLnNjb3BlLiRkZXN0cm95KCk7XHJcblx0XHR9ICk7XHJcblx0XHRhbGxQb3N0ZXJzLmNoaWxkcmVuLmxlbmd0aCA9IDA7IC8vIGNsZWFyIGl0ZW1zXHJcblx0fVxyXG5cblx0cmV0dXJuIHtcblx0XHRtYWtlSGVsaXhQb3N0ZXJzLFxuXHRcdGNsZWFyQWxsXG5cdH07XG5cbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckc3RhdGUnLCAnY29sbGVjdGlvbk1vZGFsU2VydmljZScsIGZ1bmN0aW9uICggJHN0YXRlLCBjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlICkge1xyXG5cblx0ZnVuY3Rpb24gY3RybCggJHNjb3BlLCAkZWxlbWVudCApIHtcblxyXG5cdFx0Ly8gJHNjb3BlLm1vdmllSXRlbSBvYmogaXMgcGFzc2VkIHRocnUgaXNvbGF0ZWRTY29wZSB2aWEgY29tcGlsZWQgZGlyZWN0aXZlIGluIGhlbGl4LmZhYy5qc1xyXG5cdFx0dmFyIGltZyA9IG5ldyBJbWFnZSgpO1xyXG5cdFx0dmFyIGltZ1VybCA9ICdodHRwOi8vaW1hZ2UudG1kYi5vcmcvdC9wL3cxNTQvJyArICRzY29wZS5tb3ZpZUl0ZW0ucG9zdGVyX3BhdGg7XHJcblx0XHRpbWcub25sb2FkID0gZnVuY3Rpb24gKCkge1xyXG5cclxuXHRcdFx0Ly8gdG9kbyBtb3ZlIGNzcyBpbnRvIHNhc3MsIHVzZSBjbGFzcyBpbnN0ZWFkXHJcblx0XHRcdCRlbGVtZW50LmNzcygge1xyXG5cdFx0XHRcdCd3aWR0aCc6ICcxNTBweCcsXHJcblx0XHRcdFx0J2hlaWdodCc6ICcyMzBweCcsXHJcblx0XHRcdFx0J2JhY2tncm91bmQtcmVwZWF0JzogJ25vLXJlcGVhdCcsXHJcblx0XHRcdFx0J2JhY2tncm91bmQtc2l6ZSc6ICcxNTBweCAyMzBweCcsXHJcblx0XHRcdFx0J2JhY2tncm91bmQtaW1hZ2UnOiAndXJsKCcgKyBpbWdVcmwgKyAnKScsXHJcblx0XHRcdFx0J2Rpc3BsYXknOiAnbm9uZScgLy8gcmVxdWlyZWQgZm9yIGZhZGVJbiBhbmltYXRpb25cclxuXHRcdFx0fSApO1xyXG5cdFx0XHQkZWxlbWVudC5mYWRlSW4oIDE1MDAgKTtcclxuXHJcblx0XHR9O1xyXG5cdFx0aW1nLnNyYyA9IGltZ1VybDtcclxuXG5cdFx0JGVsZW1lbnQub24oICdjbGljaycsIGZ1bmN0aW9uICggZXZ0ICkge1xyXG5cdFx0XHQkc3RhdGUuZ28oICdtb3ZpZURldGFpbCcsIHsgbW92aWVJZDogJHNjb3BlLm1vdmllSXRlbS5pZCB9ICk7XHJcblx0XHRcdGNvbGxlY3Rpb25Nb2RhbFNlcnZpY2Uuc2V0QWN0aXZlSXRlbSggJHNjb3BlLm1vdmllSXRlbSApO1xyXG5cdFx0fSApO1xuXG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdHJlc3RyaWN0OiAnRScsXG5cdFx0cmVwbGFjZTogdHJ1ZSxcblx0XHRjb250cm9sbGVyOiBjdHJsLFxuXHRcdHRlbXBsYXRlOiAnPGRpdiBjbGFzcz1cInBvc3RlckVsZW1cIj48L2Rpdj4nXG5cdH07XG5cbn0gXTtcclxuIiwiYW5ndWxhci5tb2R1bGUoICdhcHAnLCBbXG5cdCd1aS5yb3V0ZXInLFxuXHQnbmdBbmltYXRlJ1xuXSApXG4uY29uc3RhbnQoICdFTkRQT0lOVF9VUkknLCAnaHR0cDovL2xvY2FsaG9zdDo4MDAxLycgKVxuLmNvbnN0YW50KCAnVE1EQl9BUEknLCB7XG5cdGtleTogJzM3NGMwMzQyYTY0MDZkZmUwYWViM2RlMmVhMDQyYzU5Jyxcblx0dXJsOiAnaHR0cDovL2FwaS50aGVtb3ZpZWRiLm9yZy8zLydcbn0gKVxuXG4ucHJvdmlkZXIoICdsb2cnLCByZXF1aXJlKCAnLi9kZWJ1Zy9sb2cucHYuanMnICkgKVxuXG4uZmFjdG9yeSggJ3V0aWwnLCByZXF1aXJlKCAnLi91dGlsLmpzJyApIClcbi5jb250cm9sbGVyKCAnbWFpbkN0cmwnLCByZXF1aXJlKCAnLi9tYWluLmN0cmwuanMnICkgKVxuLmZhY3RvcnkoICdUTURiJywgcmVxdWlyZSggJy4vVE1EYi5mYWMuanMnICkgKVxuLmZhY3RvcnkoICdFVlQnLCByZXF1aXJlKCAnLi9ldmVudHMuZmFjLmpzJyApIClcbi5jb250cm9sbGVyKCAnbW92aWVEZXRhaWxDdHJsJywgcmVxdWlyZSggJy4vbW92aWVEZXRhaWwuY3RybC5qcycgKSApXG4uZGlyZWN0aXZlKCAnZGlzcGxheScsIHJlcXVpcmUoICcuL2hlbGl4L2Rpc3BsYXkuZGlyLmpzJyApIClcbi5mYWN0b3J5KCAnRU5HSU5FJywgcmVxdWlyZSggJy4vaGVsaXgvZW5naW5lLmZhYy5qcycgKSApXG4uZmFjdG9yeSggJ2hlbGl4JywgcmVxdWlyZSggJy4vaGVsaXgvaGVsaXguZmFjLmpzJyApIClcbi5kaXJlY3RpdmUoICdwb3N0ZXInLCByZXF1aXJlKCAnLi9oZWxpeC9wb3N0ZXIuZGlyLmpzJyApIClcblxuLmNvbnRyb2xsZXIoICdzaWdudXBDdHJsJywgcmVxdWlyZSggJy4vYXV0aC9zaWdudXAuY3RybC5qcycgKSApXG4uY29udHJvbGxlciggJ3NpZ25pbkN0cmwnLCByZXF1aXJlKCAnLi9hdXRoL3NpZ25pbi5jdHJsLmpzJyApIClcbi5jb250cm9sbGVyKCAnc2lnbm91dEN0cmwnLCByZXF1aXJlKCAnLi9hdXRoL3NpZ25vdXQuY3RybC5qcycgKSApXG5cbi5mYWN0b3J5KCAnYXV0aCcsIHJlcXVpcmUoICcuL2F1dGgvYXV0aC5mYWMuanMnICkgKVxuLmZhY3RvcnkoICdhdXRoVG9rZW4nLCByZXF1aXJlKCAnLi9hdXRoL2F1dGhUb2tlbi5mYWMuanMnICkgKVxuLmZhY3RvcnkoICdhdXRoSW50ZXJjZXB0b3InLCByZXF1aXJlKCAnLi9hdXRoL2F1dGhJbnRlcmNlcHRvci5mYWMuanMnICkgKVxuXG4uY29udHJvbGxlciggJ21vdmllQ29sbGVjdGlvbkN0cmwnLCByZXF1aXJlKCAnLi9hdXRoL21vdmllQ29sbGVjdGlvbi5jdHJsLmpzJyApIClcbi5mYWN0b3J5KCAnbW92aWVDb2xsZWN0aW9uJywgcmVxdWlyZSggJy4vbW92aWVDb2xsZWN0aW9uLmZhYy5qcycgKSApXG4uZGlyZWN0aXZlKCAnY29sbGVjdGlvbk1vZGFsJywgcmVxdWlyZSggJy4vY29sbGVjdGlvbk1vZGFsLmRpci5qcycgKSApXG4uZmFjdG9yeSggJ2NvbGxlY3Rpb25Nb2RhbFNlcnZpY2UnLCByZXF1aXJlKCAnLi9jb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLmZhYy5qcycgKSApXG4uZGlyZWN0aXZlKCAnY29sbGVjdGlvbkl0ZW0nLCByZXF1aXJlKCAnLi9jb2xsZWN0aW9uSXRlbS5kaXIuanMnICkgKVxuXG4uY29uZmlnKCBbICckc3RhdGVQcm92aWRlcicsICckdXJsUm91dGVyUHJvdmlkZXInLCAnJGh0dHBQcm92aWRlcicsXG5mdW5jdGlvbiAoICRzdGF0ZVByb3ZpZGVyLCAkdXJsUm91dGVyUHJvdmlkZXIsICRodHRwUHJvdmlkZXIgKSB7XG5cblx0JHVybFJvdXRlclByb3ZpZGVyLm90aGVyd2lzZSggJy8nICk7XG5cblx0JHN0YXRlUHJvdmlkZXJcblx0XHQuc3RhdGUoICdoZWxpeCcsIHtcblx0XHRcdHVybDogJy8nLFxuXHRcdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL2hlbGl4Lmh0bWwnXG5cdFx0fSApXG5cdFx0LnN0YXRlKCAnbW92aWVEZXRhaWwnLCB7XG5cdFx0XHR1cmw6ICcvbW92aWUvOm1vdmllSWQnLFxuXHRcdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL21vdmllLmh0bWwnLFxuXHRcdFx0Y29udHJvbGxlcjogJ21vdmllRGV0YWlsQ3RybCcsXG5cdFx0XHRjb250cm9sbGVyQXM6ICdtZCcsXG5cdFx0XHRyZXNvbHZlOiB7XG5cdFx0XHRcdG1vdmllSXRlbTogWyAnJHN0YXRlUGFyYW1zJywgJ1RNRGInLCBmdW5jdGlvbiAoICRzdGF0ZVBhcmFtcywgVE1EYiApIHtcblx0XHRcdFx0XHRyZXR1cm4gVE1EYi5zZWFyY2hCeUlkKCAkc3RhdGVQYXJhbXMubW92aWVJZCApO1xuXHRcdFx0XHR9XVxuXHRcdFx0fVxuXHRcdH0gKVxuXHRcdC5zdGF0ZSggJ3NpZ251cCcsIHtcblx0XHRcdHVybDogJy9zaWdudXAnLFxuXHRcdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL3NpZ251cC5odG1sJyxcblx0XHRcdGNvbnRyb2xsZXI6ICdzaWdudXBDdHJsJyxcblx0XHRcdGNvbnRyb2xsZXJBczogJ3NpZ251cCdcblx0XHR9IClcblx0XHQuc3RhdGUoICdzaWduaW4nLCB7XG5cdFx0XHR1cmw6ICcvc2lnbmluJyxcblx0XHRcdHRlbXBsYXRlVXJsOiAnLi90ZW1wbGF0ZS9zaWduaW4uaHRtbCcsXG5cdFx0XHRjb250cm9sbGVyOiAnc2lnbmluQ3RybCcsXG5cdFx0XHRjb250cm9sbGVyQXM6ICdzaWduaW4nXG5cdFx0fSApXG5cdFx0LnN0YXRlKCAnc2lnbm91dCcsIHtcblx0XHRcdHVybDogJy9zaWdub3V0Jyxcblx0XHRcdGNvbnRyb2xsZXI6ICdzaWdub3V0Q3RybCdcblx0XHR9IClcblx0XHQuc3RhdGUoJ2NvbGxlY3Rpb24nLCB7XG5cdFx0XHR1cmw6ICcvY29sbGVjdGlvbicsXG5cdFx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvY29sbGVjdGlvbi5odG1sJyxcblx0XHRcdGNvbnRyb2xsZXI6ICdtb3ZpZUNvbGxlY3Rpb25DdHJsJyxcblx0XHRcdGNvbnRyb2xsZXJBczogJ21jJyxcblx0XHRcdHJlc29sdmU6IHtcblx0XHRcdFx0YXV0aG9yaXplOiBbICdhdXRoJywgZnVuY3Rpb24gKCBhdXRoICkge1xuXHRcdFx0XHRcdHJldHVybiBhdXRoLmF1dGhvcml6ZSgpO1xuXHRcdFx0XHR9IF0sXG5cdFx0XHRcdHJlc29sdmVkQ29sbGVjdGlvbjogWyAnbW92aWVDb2xsZWN0aW9uJywgZnVuY3Rpb24gKCBtb3ZpZUNvbGxlY3Rpb24gKSB7XG5cdFx0XHRcdFx0cmV0dXJuIG1vdmllQ29sbGVjdGlvbi5yZXNvbHZlQ29sbGVjdGlvbigpO1xuXHRcdFx0XHR9IF1cblx0XHRcdH1cblx0XHR9KVxuXHQ7XG5cblx0JGh0dHBQcm92aWRlci5pbnRlcmNlcHRvcnMucHVzaCggJ2F1dGhJbnRlcmNlcHRvcicgKTtcblxufSBdIClcbi5ydW4oIFsgJ2xvZycsICckcm9vdFNjb3BlJywgJyRzdGF0ZScsICdhdXRoJywgJ21vdmllQ29sbGVjdGlvbicsIGZ1bmN0aW9uICggbG9nLCAkcm9vdFNjb3BlLCAkc3RhdGUsIGF1dGgsIG1vdmllQ29sbGVjdGlvbiApIHtcblxuXHQvLyB0b2RvIGF1dGhvcml6ZSB1c2VyIGV2ZXJ5IGJlZ2lubmluZyBvZiBzZXNzaW9uXG5cdC8vIHRvZG8gZG9udCBhdXRvcml6ZSB0d2ljZVxuXHRhdXRoLmF1dGhvcml6ZSggdHJ1ZSApO1xuXG5cdG1vdmllQ29sbGVjdGlvbi5yZXNvbHZlQ29sbGVjdGlvbigpO1xuXG5cdCRyb290U2NvcGUuJG9uKCAnJHN0YXRlQ2hhbmdlRXJyb3InLCBmdW5jdGlvbiAoIGV2ZW50LCB0b1N0YXRlLCB0b1BhcmFtcywgZnJvbVN0YXRlLCBmcm9tUGFyYW1zLCBlcnJvciApIHtcblxuXHRcdGV2ZW50LnByZXZlbnREZWZhdWx0KCk7IC8vIHByZXZlbnQgdHJhbnNpdGlvblxuXHRcdGxvZy5kZWJ1ZyggJ3dhcm4nLCBlcnJvciApO1xuXHRcdGlmICggZXJyb3IgKSB7XG5cdFx0XHQkc3RhdGUuZ28oICdzaWduaW4nICk7XG5cdFx0fVxuXG5cdH0gKTtcblxufSBdIClcbi5jb25maWcoIFsgJ2xvZ1Byb3ZpZGVyJywgJyRodHRwUHJvdmlkZXInLCBmdW5jdGlvbiAoIGxvZ1Byb3ZpZGVyLCAkaHR0cFByb3ZpZGVyICkge1xuXG5cdGxvZ1Byb3ZpZGVyLmVuYWJsZURlYnVnKCk7XG5cdGxvZ1Byb3ZpZGVyLmVuYWJsZURlYnVnTmFtZXNwYWNlKCAnaW5mbycsICdlcnInLCAnYXV0aCcgKTsgLy8gY3RybFxuXG5cdCRodHRwUHJvdmlkZXIudXNlTGVnYWN5UHJvbWlzZUV4dGVuc2lvbnMoIGZhbHNlICk7XG5cbn0gXSApXG47XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckc2NvcGUnLCAnVE1EYicsICdFVlQnLCAnaGVsaXgnLCAnRU5HSU5FJywgJ2F1dGgnLCAnJHN0YXRlJyxcbmZ1bmN0aW9uICggbG9nLCAkc2NvcGUsIFRNRGIsIEVWVCwgaGVsaXgsIEVOR0lORSwgYXV0aCwgJHN0YXRlICkge1xuXG5cdHZhciB2bSA9IHRoaXM7XG5cdHZtLmF1dGggPSBhdXRoO1xuXHR2bS5zZWFyY2ggPSB7XG5cdFx0cXVlcnk6ICcnLFxuXHR9O1xuXHR2bS5tb3ZpZUl0ZW1zID0gbnVsbDtcblxuXHQkc2NvcGUuJHdhdGNoKCBUTURiLmdldFJlcywgZnVuY3Rpb24gKCBtb3ZJdGVtcyApIHtcblxuXHRcdHZtLm1vdmllSXRlbXMgPSBtb3ZJdGVtcztcblx0XHRoZWxpeC5tYWtlSGVsaXhQb3N0ZXJzKCBtb3ZJdGVtcy5zbGljZSggVE1EYi5wcmV2UmVzdWx0TGVuICksIFRNRGIucHJldlJlc3VsdExlbiApO1xuXG5cdH0sIHRydWUgKTtcblxuXHR2YXIgcHJldlF1ZXJ5ID0gJyc7XG5cdHZtLnNlYXJjaCA9IGZ1bmN0aW9uICgpIHtcblx0XHRpZiAoIHZtLnNlYXJjaC5xdWVyeSA9PT0gJycgKSByZXR1cm47XG5cdFx0aWYgKCBwcmV2UXVlcnkgIT09IHZtLnNlYXJjaC5xdWVyeSApIHtcblx0XHRcdHByZXZRdWVyeSA9IHZtLnNlYXJjaC5xdWVyeTtcblx0XHRcdFRNRGIuY2xlYXJTZWFyY2goKTtcblx0XHRcdGhlbGl4LmNsZWFyQWxsKCk7XG5cdFx0XHRFTkdJTkUucmVzZXRDYW1lcmEoKTtcblx0XHR9XG5cdFx0aWYgKCAkc3RhdGUuY3VycmVudC5uYW1lICE9PSAnaGVsaXgnICkge1xuXHRcdFx0JHN0YXRlLmdvKCAnaGVsaXgnICk7XG5cdFx0fVxuXHRcdFRNRGIuc2VhcmNoQnlUaXRsZSggdm0uc2VhcmNoICk7XG5cdH07XG5cblx0Ly8gREVCVUdcblx0d2luZG93LlNDT1BFID0gJHNjb3BlO1xuXHR2bS5UTURiID0gVE1EYjtcblx0dm0uaGVsaXggPSBoZWxpeDtcblx0dm0uRU5HSU5FID0gRU5HSU5FO1xuXHR2bS5TVEFURSA9ICRzdGF0ZTtcblxuXHRFVlQuRU9QLmxpc3RlbiggZnVuY3Rpb24gKCkge1xuXHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAncmVjaWV2ZWQgRU9QIGV2ZW50IScgKTtcblx0fSApO1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdFTkRQT0lOVF9VUkknLCAnJGh0dHAnLCAnJHEnLCBmdW5jdGlvbiAoIGxvZywgRU5EUE9JTlRfVVJJLCAkaHR0cCwgJHEgKSB7XHJcblxyXG5cdHZhciBEQl9FTkRQT0lOVCA9IEVORFBPSU5UX1VSSSArICdjb2xsZWN0aW9uJztcclxuXHR2YXIgY29sbGVjdGlvbiA9IG51bGw7XHJcblxyXG5cdHZhciBmdWxsQ29sbGVjdGlvbiA9IG51bGw7XHJcblxyXG5cdGZ1bmN0aW9uIGNyZWF0ZSggbmFtZSApIHtcclxuXHRcdC8vIGNvbGxlY3Rpb24gbmVlZHMgdG8gYmUgcmVzb2x2ZWQgZmlyc3RcclxuXHRcdC8vIHRvZG8gY2hlY2sgaWYgY29sbGVjdGlvbiBpcyBhbHJlZHkgZXhpc3RzXHJcblx0XHRjb2xsZWN0aW9uLnB1c2goIHsgY29sbGVjdGlvbk5hbWU6IG5hbWUsIG1vdmllczogW10gfSApO1xyXG5cdFx0cHV0KCk7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBpc0VtcHR5KCkge1xyXG5cdFx0cmV0dXJuIGNvbGxlY3Rpb24ubGVuZ3RoID09PSAwO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gcmVzb2x2ZUNvbGxlY3Rpb24oKSB7XHJcblxyXG5cdFx0dmFyIGRlZmVycmVkID0gJHEuZGVmZXIoKTtcclxuXHJcblx0XHRpZiAoIGNvbGxlY3Rpb24gIT09IG51bGwgKSB7XHJcblx0XHRcdGRlZmVycmVkLnJlc29sdmUoIGNvbGxlY3Rpb24gKTtcclxuXHRcdH0gZWxzZSB7XHJcblx0XHRcdCRodHRwLmdldCggREJfRU5EUE9JTlQsIHsgcmVxdWlyZUF1dGg6IHRydWUgfSApXHJcblx0XHRcdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cdFx0XHRcdFx0bG9nLmRlYnVnKCAnaW5mbycsICdjb2xsZWN0aW9uLnJlc29sdmVDb2xsZWN0aW9uKCk6JywgcmVzICk7XHJcblx0XHRcdFx0XHRpZiAoIHJlcy5kYXRhICkge1xyXG5cdFx0XHRcdFx0XHRjb2xsZWN0aW9uID0gcmVzLmRhdGE7XHJcblx0XHRcdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdFx0XHRjb2xsZWN0aW9uID0gW107XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0XHRkZWZlcnJlZC5yZXNvbHZlKCB0cnVlICk7XHJcblx0XHRcdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XHJcblx0XHRcdFx0XHRsb2cuZGVidWcoICd3YXJuJywgJ2NvbGxlY3Rpb24ucmVzb2x2ZUNvbGxlY3Rpb24oKTonLCBlcnIgKTtcclxuXHRcdFx0XHRcdGRlZmVycmVkLnJlamVjdCggZXJyICk7XHJcblx0XHRcdFx0fSApO1xyXG5cdFx0fVxyXG5cclxuXHRcdHJldHVybiBkZWZlcnJlZC5wcm9taXNlO1xyXG5cclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIGhhc0l0ZW0oIGl0ZW1JZCwgc29tZUNvbGxlY3Rpb24gKSB7XHJcblx0XHRmb3IgKCB2YXIgaSA9IDA7IGkgPCBjb2xsZWN0aW9uLmxlbmd0aDsgaSArKyApIHtcclxuXHRcdFx0aWYgKCBjb2xsZWN0aW9uW2ldLmNvbGxlY3Rpb25OYW1lID09PSBzb21lQ29sbGVjdGlvbiApIHtcclxuXHRcdFx0XHRmb3IgKCB2YXIgayA9IDA7IGsgPCBjb2xsZWN0aW9uW2ldLm1vdmllcy5sZW5ndGg7IGsgKysgKSB7XHJcblx0XHRcdFx0XHRpZiAoIGNvbGxlY3Rpb25baV0ubW92aWVzW2tdID09PSBpdGVtSWQgKSB7XHJcblx0XHRcdFx0XHRcdHJldHVybiB0cnVlO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cdFx0cmV0dXJuIGZhbHNlO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gcHV0KCkge1xyXG5cdFx0JGh0dHAucHV0KCBEQl9FTkRQT0lOVCwgY29sbGVjdGlvbiwgeyByZXF1aXJlQXV0aDogdHJ1ZSB9IClcclxuXHRcdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cdFx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnY29sbGVjdGlvbi5wdXQoKTonLCByZXMgKTtcclxuXHRcdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XHJcblx0XHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ2NvbGxlY3Rpb24ucHV0KCk6JywgZXJyICk7XHJcblx0XHRcdH0gKTtcclxuXHR9XHJcblxyXG5cdC8qIGNvbGxlY3Rpb25zIG5lZWRzIHRvIGJlIHJlc29sdmVkIGZpcnN0XHJcblx0dXBkYXRlIGxvY2FsIGNvbGxlY3Rpb25cclxuXHQqL1xyXG5cdGZ1bmN0aW9uIHB1c2goIGl0ZW1JZCwgdG9Db2xsZWN0aW9uICkge1xyXG5cdFx0aWYgKCBoYXNJdGVtKCBpdGVtSWQsIHRvQ29sbGVjdGlvbiApICkge1xyXG5cdFx0XHRyZXR1cm4gZmFsc2U7XHJcblx0XHR9XHJcblx0XHRmb3IgKCB2YXIgaSA9IDA7IGkgPCBjb2xsZWN0aW9uLmxlbmd0aDsgaSArKyApIHtcclxuXHRcdFx0aWYgKCBjb2xsZWN0aW9uW2ldLmNvbGxlY3Rpb25OYW1lID09PSB0b0NvbGxlY3Rpb24gKSB7XHJcblx0XHRcdFx0Y29sbGVjdGlvbltpXS5tb3ZpZXMucHVzaCggaXRlbUlkICk7XHJcblx0XHRcdFx0cHV0KCk7XHJcblx0XHRcdFx0cmV0dXJuIHRydWU7XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHRcdHJldHVybiBmYWxzZTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIHJlbW92ZSggaXRlbUlkLCBpbkNvbGxlY3Rpb24gKSB7XHJcblx0XHRmb3IgKCB2YXIgaSA9IDA7IGkgPCBjb2xsZWN0aW9uLmxlbmd0aDsgaSArKyApIHtcclxuXHRcdFx0aWYgKCBjb2xsZWN0aW9uW2ldLmNvbGxlY3Rpb25OYW1lID09PSBpbkNvbGxlY3Rpb24gKSB7XHJcblx0XHRcdFx0Zm9yICggdmFyIGsgPSAwOyBrIDwgY29sbGVjdGlvbltpXS5tb3ZpZXMubGVuZ3RoOyBrICsrICkge1xyXG5cdFx0XHRcdFx0aWYgKCBjb2xsZWN0aW9uW2ldLm1vdmllc1trXSA9PT0gaXRlbUlkICkge1xyXG5cdFx0XHRcdFx0XHR2YXIgcmVtb3ZlZCA9IGNvbGxlY3Rpb25baV0ubW92aWVzLnNwbGljZSggaywgMSApLmxlbmd0aDtcclxuXHRcdFx0XHRcdFx0cHV0KCk7XHJcblx0XHRcdFx0XHRcdHJldHVybiByZW1vdmVkICE9PSAwO1xyXG5cdFx0XHRcdFx0fVxyXG5cdFx0XHRcdH1cclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cdFx0cmV0dXJuIGZhbHNlO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gcmVtb3ZlQ29sbGVjdGlvbiggY29sbGVjdGlvbk5hbWUgKSB7XHJcblx0XHRmb3IgKCB2YXIgaSA9IDA7IGkgPCBjb2xsZWN0aW9uLmxlbmd0aDsgaSArKyApIHtcclxuXHRcdFx0aWYgKCBjb2xsZWN0aW9uW2ldLmNvbGxlY3Rpb25OYW1lID09PSBjb2xsZWN0aW9uTmFtZSApIHtcclxuXHRcdFx0XHR2YXIgcmVtb3ZlZCA9IGNvbGxlY3Rpb24uc3BsaWNlKCBpLCAxICkubGVuZ3RoO1xyXG5cdFx0XHRcdHB1dCgpO1xyXG5cdFx0XHRcdHJldHVybiByZW1vdmVkICE9PSAwO1xyXG5cdFx0XHR9XHJcblx0XHR9XHJcblx0XHRyZXR1cm4gZmFsc2U7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBzeW5jKCkge1xyXG5cdFx0Ly8gc3luYyBsb2NhbCBjb2xlbGN0aW9uIHcvIERCXHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBnZXRDb2xsZWN0aW9uKCkge1xyXG5cdFx0cmV0dXJuIGNvbGxlY3Rpb247XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBfY2xlYXIoKSB7XHJcblx0XHRjb2xsZWN0aW9uID0gbnVsbDtcclxuXHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnbG9jYWwgY29sbGVjdGlvbiBjbGVhcmVkLicgKTtcclxuXHR9XHJcblxyXG5cdHJldHVybiB7XHJcblx0XHRnZXRDb2xsZWN0aW9uLFxyXG5cdFx0Y3JlYXRlLFxyXG5cdFx0cHVzaCxcclxuXHRcdHB1dCxcclxuXHRcdHJlbW92ZSxcclxuXHRcdHJlbW92ZUNvbGxlY3Rpb24sXHJcblx0XHRzeW5jLFxyXG5cdFx0X2NsZWFyLFxyXG5cdFx0cmVzb2x2ZUNvbGxlY3Rpb24sXHJcblx0XHRoYXNJdGVtLFxyXG5cdFx0aXNFbXB0eVxyXG5cdH07XHJcblxyXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJyRzY29wZScsICdUTURiJywgJyRjYWNoZUZhY3RvcnknLCAnbW92aWVJdGVtJywgJ2NvbGxlY3Rpb25Nb2RhbFNlcnZpY2UnLFxyXG5mdW5jdGlvbiggbG9nLCAkc2NvcGUsIFRNRGIsICRjYWNoZUZhY3RvcnksIG1vdmllSXRlbSwgY29sbGVjdGlvbk1vZGFsU2VydmljZSApIHtcclxuXHJcblx0dmFyIHZtID0gdGhpcztcclxuXHR2bS5tb3ZpZUl0ZW0gPSBtb3ZpZUl0ZW07IC8vIG1vdmllSXRlbSBpbmplY3RlZCB2aWEgc3RhdGUgcmVzb2x2ZVxyXG5cdGxvZy5kZWJ1ZyggJ2N0cmwnLCAnbW92aWVEZXRhaWwgY3RybCByZXNvbHZlZDonLCB2bS5tb3ZpZUl0ZW0gKTtcclxuXHJcblx0bW92aWVJdGVtLmZ1bGxUaXRsZSA9IG1vdmllSXRlbS50aXRsZTtcclxuXHRpZiAoIG1vdmllSXRlbS50aXRsZSAhPT0gbW92aWVJdGVtLm9yaWdpbmFsX3RpdGxlICkge1xyXG5cdFx0bW92aWVJdGVtLmZ1bGxUaXRsZSA9IG1vdmllSXRlbS50aXRsZSArICcgKCcgKyBtb3ZpZUl0ZW0ub3JpZ2luYWxfdGl0bGUgKyAnKSc7XHJcblx0fVxyXG5cclxuXHRpZiAoIG1vdmllSXRlbS5iYWNrZHJvcF9wYXRoICkge1xyXG5cdFx0dmFyIGltZ1VybCA9ICdodHRwOi8vaW1hZ2UudG1kYi5vcmcvdC9wL29yaWdpbmFsJyArIG1vdmllSXRlbS5iYWNrZHJvcF9wYXRoO1xyXG5cdFx0JCggJy5iYWNrZHJvcCcgKS5jc3MoIHtcclxuXHRcdFx0J2JhY2tncm91bmQtaW1hZ2UnOiAndXJsKCcgKyBpbWdVcmwgKyAnKSdcclxuXHRcdH0gKTtcclxuXHR9XHJcblxyXG5cdHZtLm9wZW5Db2xsZWN0aW9uTW9kYWwgPSBmdW5jdGlvbiAoKSB7XHJcblx0XHRjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLnNldEFjdGl2ZUl0ZW0oIG1vdmllSXRlbSApO1xyXG5cdFx0Y29sbGVjdGlvbk1vZGFsU2VydmljZS5vcGVuKCk7XHJcblx0fTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbIGZ1bmN0aW9uICgpIHtcclxuXHJcblx0ZnVuY3Rpb24gZGVib3VuY2UoIGZ1bmMsIHdhaXQsIGltbWVkaWF0ZSApIHtcclxuXHRcdHZhciBfdGhpcyA9IHRoaXMsXHJcblx0XHRcdF9hcmd1bWVudHMgPSBhcmd1bWVudHM7XHJcblxyXG5cdFx0dmFyIHRpbWVvdXQ7XHJcblx0XHRyZXR1cm4gZnVuY3Rpb24gKCkge1xyXG5cclxuXHRcdFx0dmFyIGNvbnRleHQgPSBfdGhpcyxcclxuXHRcdFx0XHRhcmdzID0gX2FyZ3VtZW50cztcclxuXHRcdFx0dmFyIGxhdGVyID0gZnVuY3Rpb24gbGF0ZXIoKSB7XHJcblxyXG5cdFx0XHRcdHRpbWVvdXQgPSBudWxsO1xyXG5cdFx0XHRcdGlmICggIWltbWVkaWF0ZSApIGZ1bmMuYXBwbHkoIGNvbnRleHQsIGFyZ3MgKTtcclxuXHRcdFx0fTtcclxuXHRcdFx0dmFyIGNhbGxOb3cgPSBpbW1lZGlhdGUgJiYgIXRpbWVvdXQ7XHJcblx0XHRcdGNsZWFyVGltZW91dCggdGltZW91dCApO1xyXG5cdFx0XHR0aW1lb3V0ID0gc2V0VGltZW91dCggbGF0ZXIsIHdhaXQgKTtcclxuXHRcdFx0aWYgKCBjYWxsTm93ICkgZnVuYy5hcHBseSggY29udGV4dCwgYXJncyApO1xyXG5cdFx0fTtcclxuXHR9XHJcblxyXG5cdHJldHVybiB7XHJcblx0XHRkZWJvdW5jZVxyXG5cdH07XHJcblxyXG59IF07XHJcbiJdfQ==
