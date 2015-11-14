(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

module.exports = ['log', '$http', 'TMDB_API', 'EVT', '$cacheFactory', '$q', 'ENDPOINT_URI', function (log, $http, TMDB_API, EVT, $cacheFactory, $q, ENDPOINT_URI) {

	var searchResult = [];
	var totalPages = -1;
	var currPage = 1;

	var movieIdCache = $cacheFactory('movieIdCache');
	// TMDB_API.url + 'movie/now_playing'

	var DB_ENDPOINT = ENDPOINT_URI + 'movie/';

	function putItemToDB(movieItem) {
		// todo dont put exisiting item in db ( UPSERT )
		$http.put(DB_ENDPOINT + movieItem.id, movieItem).then(function (res) {
			log.debug('api', 'PUT:', res);
		}, function (err) {
			log.debug('err', 'PUT:', err);
		});
	}

	function searchIdFromDB(id) {
		var promise = $http.get(DB_ENDPOINT + id).then(function (res) {
			log.debug('api', 'searchById => DB:', res.data);
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
			log.debug('api', 'searchById => API:', res.data);
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
			log.debug('api', 'searchById => cache:', cachedItem);
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

		$http.get(TMDB_API.url + 'search/movie', {
			cache: true,
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
			log.debug('api', 'searchByTitle:', res, res.data);

			// cache
			res.data.results.forEach(function (item) {

				if (!movieIdCache.get(item.id)) {
					log.debug('api', item.id, item);
					movieIdCache.put(item.id, item);
				}
			});
		}, function (err) {
			// emit event search err
			log.debug('err', 'searchByTitle:', err);
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
		totalPages = -1;
		currPage = 1;
	}

	return {
		searchByTitle: searchByTitle,
		searchById: searchById,
		clearSearch: clearSearch,
		getRes: getRes,
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

				log.debug('auth', 'auth.authorize():', res, res.data);
				identity = res.data;
				_identityResolved = true;
				deferred.resolve(true);
			}, function (err) {

				log.debug('err', 'authorize', err, err.data);
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
		log.debug('auth', 'token removed');
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

module.exports = ['log', '$scope', '$http', 'ENDPOINT_URI', 'authToken', '$state', function (log, $scope, $http, ENDPOINT_URI, authToken, $state) {

	var vm = this;
	vm.user = {
		email: '',
		password: ''
	};

	vm.signin = function () {

		if (vm.user.email === '' || vm.user.password === '') {
			log.debug('auth', 'email & password required.');
			return;
		}

		$http.post(ENDPOINT_URI + 'signin', vm.user).then(function (res) {
			log.debug('auth', 'signin', res, res.data);
			authToken.setToken(res.data.token);
			$state.go('collection');
		}, function (err, status) {
			log.debug('err', 'signin', err);
		});
	};
}];

},{}],6:[function(require,module,exports){
'use strict';

module.exports = ['$state', 'auth', 'movieCollection', function ($state, auth, movieCollection) {

	auth.deauthorize();
	movieCollection._clear();
	$state.go('signin');
}];

},{}],7:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', '$http', 'ENDPOINT_URI', 'authToken', '$state', function (log, $scope, $http, ENDPOINT_URI, authToken, $state) {

	var vm = this;
	vm.user = {};

	vm.signup = function () {

		if (vm.user.email === undefined || vm.user.password === undefined) {
			log.debug('warn', 'email & password required.');
			return;
		}

		log.debug('auth', 'signing up...');
		$http.post(ENDPOINT_URI + 'signup', vm.user).then(function (res) {

			log.debug('auth', 'Registered.', res);

			authToken.setToken(res.data.token);
			$state.go('collection');
		}, function (err) {

			log.debug('err', err);
			vm.form.$submitted = false;
		});
	};
}];

},{}],8:[function(require,module,exports){
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
				console.log.apply(console, [debugName].concat(slicedArgs));
			}
		}

		return {
			debug: debug
		};
	};
}];

},{}],10:[function(require,module,exports){
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

},{}],11:[function(require,module,exports){
'use strict';

module.exports = ['$httpProvider', function ($httpProvider) {
	$httpProvider.interceptors.push('authInterceptor');
}];

},{}],12:[function(require,module,exports){
'use strict';

module.exports = ['logProvider', '$httpProvider', function (logProvider, $httpProvider) {

	logProvider.enableDebug();
	// logProvider.enableDebugNamespace( 'info', 'err', 'auth', 'api', 'collection' );
	logProvider.enableDebugNamespace('info', 'err');

	$httpProvider.useLegacyPromiseExtensions(false);
}];

},{}],13:[function(require,module,exports){
'use strict';

module.exports = ['$stateProvider', '$urlRouterProvider', '$httpProvider', function ($stateProvider, $urlRouterProvider, $httpProvider) {

	$urlRouterProvider.otherwise('/');

	$stateProvider.state('helix', {
		url: '/',
		templateUrl: './template/helix.html'
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
	}).state('movieDetail', {
		url: '/movie/:movieId',
		templateUrl: './template/movieDetail.html',
		controller: 'movieDetailCtrl',
		controllerAs: 'md',
		resolve: {
			movieItem: ['$stateParams', 'TMDb', function ($stateParams, TMDb) {
				return TMDb.searchById($stateParams.movieId);
			}]
		}
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
}];

},{}],14:[function(require,module,exports){
'use strict';

module.exports = [function () {

	function link($scope, $element, $attrs) {

		$element.on('mouseenter', function () {
			$element.removeClass($attrs.leave);
			$element.addClass($attrs.hover);
		}).on('mouseleave', function () {
			$element.removeClass($attrs.hover);
			$element.addClass($attrs.leave);
		});
	}

	return {
		restrict: 'A',
		link: link
	};
}];

},{}],15:[function(require,module,exports){
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

},{}],16:[function(require,module,exports){
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

},{}],17:[function(require,module,exports){
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

},{}],18:[function(require,module,exports){
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

},{}],19:[function(require,module,exports){
'use strict';

angular.module('app', ['ui.router', 'ngAnimate']).constant('ENDPOINT_URI', 'http://localhost:8001/').constant('TMDB_API', {
	key: '374c0342a6406dfe0aeb3de2ea042c59',
	url: 'http://api.themoviedb.org/3/'
}).provider('log', require('./common/log.pv.js')).factory('util', require('./common/util.js')).factory('EVT', require('./common/events.fac.js')).factory('TMDb', require('./API/TMDb.fac.js')).controller('mainCtrl', require('./main.ctrl.js')).factory('ENGINE', require('./helix/engine.fac.js')).factory('helix', require('./helix/helix.fac.js')).directive('display', require('./helix/display.dir.js')).directive('poster', require('./helix/poster.dir.js')).controller('movieDetailCtrl', require('./movieDetail.ctrl.js')).factory('auth', require('./auth/auth.fac.js')).factory('authToken', require('./auth/authToken.fac.js')).factory('authInterceptor', require('./auth/authInterceptor.fac.js')).controller('signupCtrl', require('./auth/signup.ctrl.js')).controller('signinCtrl', require('./auth/signin.ctrl.js')).controller('signoutCtrl', require('./auth/signout.ctrl.js')).controller('movieCollectionCtrl', require('./movieCollection/movieCollection.ctrl.js')).factory('movieCollection', require('./movieCollection/movieCollection.fac.js')).factory('collectionModalService', require('./movieCollection/collectionModalService.fac.js')).directive('collectionModal', require('./movieCollection/collectionModal.dir.js')).directive('collectionItem', require('./movieCollection/collectionItem.dir.js')).directive('hoverClass', require('./directive/hoverClass.dir.js')).config(require('./config/routeConfig.js')).config(require('./config/logConfig.js')).config(require('./config/httpConfig.js')).run(['log', '$rootScope', '$state', 'auth', 'movieCollection', function (log, $rootScope, $state, auth, movieCollection) {

	auth.authorize(true);

	movieCollection.resolveCollection();

	$rootScope.$on('$stateChangeError', function (event, toState, toParams, fromState, fromParams, error) {

		event.preventDefault(); // prevent transition
		log.debug('warn', error);
		if (error) {
			$state.go('signin');
		}
	});
}]);

},{"./API/TMDb.fac.js":1,"./auth/auth.fac.js":2,"./auth/authInterceptor.fac.js":3,"./auth/authToken.fac.js":4,"./auth/signin.ctrl.js":5,"./auth/signout.ctrl.js":6,"./auth/signup.ctrl.js":7,"./common/events.fac.js":8,"./common/log.pv.js":9,"./common/util.js":10,"./config/httpConfig.js":11,"./config/logConfig.js":12,"./config/routeConfig.js":13,"./directive/hoverClass.dir.js":14,"./helix/display.dir.js":15,"./helix/engine.fac.js":16,"./helix/helix.fac.js":17,"./helix/poster.dir.js":18,"./main.ctrl.js":20,"./movieCollection/collectionItem.dir.js":21,"./movieCollection/collectionModal.dir.js":22,"./movieCollection/collectionModalService.fac.js":23,"./movieCollection/movieCollection.ctrl.js":24,"./movieCollection/movieCollection.fac.js":25,"./movieDetail.ctrl.js":26}],20:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', 'TMDb', 'EVT', 'helix', 'ENGINE', 'auth', '$state', function (log, $scope, TMDb, EVT, helix, ENGINE, auth, $state) {

	var vm = this;
	vm.auth = auth;
	vm.search = {
		query: ''
	};
	vm.movieItems = null;

	$scope.$watch(TMDb.getRes, function (movItems, oldMovItems) {

		vm.movieItems = movItems;
		helix.makeHelixPosters(movItems.slice(oldMovItems.length), oldMovItems.length);
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

},{}],21:[function(require,module,exports){
'use strict';

module.exports = ['log', 'TMDb', function (log, TMDb) {

	function ctrl($scope, $attrs, $element) {

		TMDb.searchById(parseInt($scope.movieId)).then(function (res) {

			// log.debug( 'info', 'collectionItemDirective', res );
			var imgUrl = 'http://image.tmdb.org/t/p/w92/' + res.poster_path;
			$element.css({
				'width': '100%',
				'height': '100%',
				'background-repeat': 'no-repeat',
				'background-size': '100% 100%',
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

},{}],22:[function(require,module,exports){
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
			$scope.newCollectionName = '';
			vm.closeEditor();
		};

		vm.addToCollection = function (movieId, collectionName) {
			log.debug('collection', 'addToCollection:', movieId, collectionName);
			var success = movieCollection.push(movieId, collectionName);
			log.debug('collection', 'movieCollection.push', success);
		};

		vm.closeModal = function () {
			vm.addingNewCollection = false;
			$scope.newCollectionName = '';
			collectionModalService.close();
		};

		// default css at directive initialization
		$element.css({ visibility: 'hidden' });

		EVT.collectionModalOpen.listen(function () {
			log.debug('collection', 'collectionModalOpen');
			$element.css({ visibility: 'visible' });
		});

		EVT.collectionModalClose.listen(function () {
			log.debug('collection', 'collectionModalClose');
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

},{}],23:[function(require,module,exports){
'use strict';

module.exports = ['log', 'EVT', 'auth', '$state', function (log, EVT, auth, $state) {

	var activeItem = null;

	function setActiveItem(item) {
		activeItem = item;
	}

	function getActiveItem(item) {
		return activeItem;
	}

	function open() {
		if (auth.isAuthenticated()) {
			EVT.collectionModalOpen.emit();
		} else {
			$state.go('signin');
		}
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

},{}],24:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', 'auth', 'movieCollection', 'TMDb', 'helix', 'ENGINE', '$state', function (log, $scope, auth, movieCollection, TMDb, helix, ENGINE, $state) {

	log.debug('collection', 'collectionCtrl', movieCollection.getCollection());
	var vm = this;
	vm.movieCollection = movieCollection;

	vm.viewCollection = function (collection) {

		log.debug('info', 'viewCollection =>', collection);

		var loadedItems = 0;
		var totalItems = collection.movies.length;
		var allMovies = [];

		collection.movies.forEach(function (movieId) {

			TMDb.searchById(movieId).then(function (res) {
				allMovies.push(res);
			}, function (err) {
				log.debug('err', 'viewCollection =>', err);
			})['finally'](function () {
				if (++loadedItems === totalItems) {

					helix.clearAll();
					ENGINE.resetCamera();
					helix.makeHelixPosters(allMovies, 0);
					$state.go('helix');
				}
			});
		});
	};
}];

},{}],25:[function(require,module,exports){
'use strict';

module.exports = ['log', 'ENDPOINT_URI', '$http', '$q', function (log, ENDPOINT_URI, $http, $q) {

	var DB_ENDPOINT = ENDPOINT_URI + 'collection';
	var collection = null;

	var fullCollection = null;

	function create(name) {
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
				log.debug('collection', 'collection.resolveCollection():', res);
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
			log.debug('collection', 'collection.put():', res);
		}, function (err) {
			log.debug('err', 'collection.put():', err);
		});
	}

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
		log.debug('collection', 'local collection cleared.');
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

},{}],26:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', 'TMDb', '$cacheFactory', 'movieItem', 'collectionModalService', 'movieCollection', function (log, $scope, TMDb, $cacheFactory, movieItem, collectionModalService, movieCollection) {

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

},{}]},{},[19])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCIvVXNlcnMvTklYL0RvY3VtZW50cy9hcHBzX3BqL0hlbGl4L3NyYy9BUEkvVE1EYi5mYWMuanMiLCIvVXNlcnMvTklYL0RvY3VtZW50cy9hcHBzX3BqL0hlbGl4L3NyYy9hdXRoL2F1dGguZmFjLmpzIiwiL1VzZXJzL05JWC9Eb2N1bWVudHMvYXBwc19wai9IZWxpeC9zcmMvYXV0aC9hdXRoSW50ZXJjZXB0b3IuZmFjLmpzIiwiL1VzZXJzL05JWC9Eb2N1bWVudHMvYXBwc19wai9IZWxpeC9zcmMvYXV0aC9hdXRoVG9rZW4uZmFjLmpzIiwiL1VzZXJzL05JWC9Eb2N1bWVudHMvYXBwc19wai9IZWxpeC9zcmMvYXV0aC9zaWduaW4uY3RybC5qcyIsIi9Vc2Vycy9OSVgvRG9jdW1lbnRzL2FwcHNfcGovSGVsaXgvc3JjL2F1dGgvc2lnbm91dC5jdHJsLmpzIiwiL1VzZXJzL05JWC9Eb2N1bWVudHMvYXBwc19wai9IZWxpeC9zcmMvYXV0aC9zaWdudXAuY3RybC5qcyIsIi9Vc2Vycy9OSVgvRG9jdW1lbnRzL2FwcHNfcGovSGVsaXgvc3JjL2NvbW1vbi9ldmVudHMuZmFjLmpzIiwiL1VzZXJzL05JWC9Eb2N1bWVudHMvYXBwc19wai9IZWxpeC9zcmMvY29tbW9uL2xvZy5wdi5qcyIsIi9Vc2Vycy9OSVgvRG9jdW1lbnRzL2FwcHNfcGovSGVsaXgvc3JjL2NvbW1vbi91dGlsLmpzIiwiL1VzZXJzL05JWC9Eb2N1bWVudHMvYXBwc19wai9IZWxpeC9zcmMvY29uZmlnL2h0dHBDb25maWcuanMiLCIvVXNlcnMvTklYL0RvY3VtZW50cy9hcHBzX3BqL0hlbGl4L3NyYy9jb25maWcvbG9nQ29uZmlnLmpzIiwiL1VzZXJzL05JWC9Eb2N1bWVudHMvYXBwc19wai9IZWxpeC9zcmMvY29uZmlnL3JvdXRlQ29uZmlnLmpzIiwiL1VzZXJzL05JWC9Eb2N1bWVudHMvYXBwc19wai9IZWxpeC9zcmMvZGlyZWN0aXZlL2hvdmVyQ2xhc3MuZGlyLmpzIiwiL1VzZXJzL05JWC9Eb2N1bWVudHMvYXBwc19wai9IZWxpeC9zcmMvaGVsaXgvZGlzcGxheS5kaXIuanMiLCIvVXNlcnMvTklYL0RvY3VtZW50cy9hcHBzX3BqL0hlbGl4L3NyYy9oZWxpeC9lbmdpbmUuZmFjLmpzIiwiL1VzZXJzL05JWC9Eb2N1bWVudHMvYXBwc19wai9IZWxpeC9zcmMvaGVsaXgvaGVsaXguZmFjLmpzIiwiL1VzZXJzL05JWC9Eb2N1bWVudHMvYXBwc19wai9IZWxpeC9zcmMvaGVsaXgvcG9zdGVyLmRpci5qcyIsIi9Vc2Vycy9OSVgvRG9jdW1lbnRzL2FwcHNfcGovSGVsaXgvc3JjL2luZGV4LmpzIiwiL1VzZXJzL05JWC9Eb2N1bWVudHMvYXBwc19wai9IZWxpeC9zcmMvbWFpbi5jdHJsLmpzIiwiL1VzZXJzL05JWC9Eb2N1bWVudHMvYXBwc19wai9IZWxpeC9zcmMvbW92aWVDb2xsZWN0aW9uL2NvbGxlY3Rpb25JdGVtLmRpci5qcyIsIi9Vc2Vycy9OSVgvRG9jdW1lbnRzL2FwcHNfcGovSGVsaXgvc3JjL21vdmllQ29sbGVjdGlvbi9jb2xsZWN0aW9uTW9kYWwuZGlyLmpzIiwiL1VzZXJzL05JWC9Eb2N1bWVudHMvYXBwc19wai9IZWxpeC9zcmMvbW92aWVDb2xsZWN0aW9uL2NvbGxlY3Rpb25Nb2RhbFNlcnZpY2UuZmFjLmpzIiwiL1VzZXJzL05JWC9Eb2N1bWVudHMvYXBwc19wai9IZWxpeC9zcmMvbW92aWVDb2xsZWN0aW9uL21vdmllQ29sbGVjdGlvbi5jdHJsLmpzIiwiL1VzZXJzL05JWC9Eb2N1bWVudHMvYXBwc19wai9IZWxpeC9zcmMvbW92aWVDb2xsZWN0aW9uL21vdmllQ29sbGVjdGlvbi5mYWMuanMiLCIvVXNlcnMvTklYL0RvY3VtZW50cy9hcHBzX3BqL0hlbGl4L3NyYy9tb3ZpZURldGFpbC5jdHJsLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7QUNBQSxNQUFNLENBQUMsT0FBTyxHQUFHLENB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LENBQUUsTUFBTSxFQUFFLDRCQUE0QixFQUFFLEVBQUUsQ0FBQyxTQUFTLENBQUUsQ0FBQzs7QUFFaEUsVUFBUyxDQUFDLFNBQVMsR0FBRyxTQUFTLENBQUMsS0FBSyxDQUFDO0FBQ3RDLEtBQUssU0FBUyxDQUFDLEtBQUssS0FBSyxTQUFTLENBQUMsY0FBYyxFQUFHO0FBQ25ELFdBQVMsQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDLEtBQUssR0FBRyxJQUFJLEdBQUcsU0FBUyxDQUFDLGNBQWMsR0FBRyxHQUFHLENBQUM7RUFDOUU7O0FBRUQsS0FBSyxTQUFTLENBQUMsYUFBYSxFQUFHO0FBQzlCLE1BQUksTUFBTSxHQUFHLG9DQUFvQyxHQUFHLFNBQVMsQ0FBQyxhQUFhLENBQUM7QUFDNUUsR0FBQyxDQUFFLFdBQVcsQ0FBRSxDQUFDLEdBQUcsQ0FBRTtBQUNyQixxQkFBa0IsRUFBRSxNQUFNLEdBQUcsTUFBTSxHQUFHLEdBQUc7R0FDekMsQ0FBRSxDQUFDO0VBQ0o7O0FBRUQsR0FBRSxDQUFDLG1CQUFtQixHQUFHLFlBQVk7QUFDcEMsd0JBQXNCLENBQUMsYUFBYSxDQUFFLFNBQVMsQ0FBRSxDQUFDO0FBQ2xELHdCQUFzQixDQUFDLElBQUksRUFBRSxDQUFDO0VBQzlCLENBQUM7Q0FFRixDQUFFLENBQUMiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJGh0dHAnLCAnVE1EQl9BUEknLCAnRVZUJywgJyRjYWNoZUZhY3RvcnknLCAnJHEnLCAnRU5EUE9JTlRfVVJJJyxcbmZ1bmN0aW9uICggbG9nLCAkaHR0cCwgVE1EQl9BUEksIEVWVCwgJGNhY2hlRmFjdG9yeSwgJHEsIEVORFBPSU5UX1VSSSApIHtcblxuXHR2YXIgc2VhcmNoUmVzdWx0ID0gW107XG5cdHZhciB0b3RhbFBhZ2VzID0gLTE7XG5cdHZhciBjdXJyUGFnZSA9IDE7XG5cblx0dmFyIG1vdmllSWRDYWNoZSA9ICRjYWNoZUZhY3RvcnkoICdtb3ZpZUlkQ2FjaGUnICk7XG5cdC8vIFRNREJfQVBJLnVybCArICdtb3ZpZS9ub3dfcGxheWluZydcblxuXHR2YXIgREJfRU5EUE9JTlQgPSBFTkRQT0lOVF9VUkkgKyAnbW92aWUvJztcblxuXHRmdW5jdGlvbiBwdXRJdGVtVG9EQiggbW92aWVJdGVtICkge1xuXHRcdC8vIHRvZG8gZG9udCBwdXQgZXhpc2l0aW5nIGl0ZW0gaW4gZGIgKCBVUFNFUlQgKVxuXHRcdCRodHRwLnB1dCggREJfRU5EUE9JTlQgKyBtb3ZpZUl0ZW0uaWQsIG1vdmllSXRlbSApXG5cdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xuXHRcdFx0bG9nLmRlYnVnKCAnYXBpJywgJ1BVVDonLCByZXMgKTtcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcblx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdQVVQ6JywgZXJyICk7XG5cdFx0fSApO1xuXHR9XG5cblx0ZnVuY3Rpb24gc2VhcmNoSWRGcm9tREIoIGlkICkge1xuXHRcdHZhciBwcm9taXNlID0gJGh0dHAuZ2V0KCBEQl9FTkRQT0lOVCArIGlkIClcblx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XG5cdFx0XHRsb2cuZGVidWcoICdhcGknLCAnc2VhcmNoQnlJZCA9PiBEQjonLCByZXMuZGF0YSApO1xuXHRcdFx0aWYgKCByZXMuZGF0YSApIHtcblx0XHRcdFx0bW92aWVJZENhY2hlLnB1dCggcmVzLmRhdGEuaWQsIHJlcy5kYXRhICk7XG5cdFx0XHRcdHJldHVybiByZXMuZGF0YTtcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdHJldHVybiBudWxsO1xuXHRcdFx0fVxuXHRcdH0sIGZ1bmN0aW9uKCBlcnIgKSB7XG5cdFx0XHRsb2cuZGVidWcoICdlcnInLCAnc2VhcmNoQnlJZCA9PiBEQjonLCBlcnIgKTtcblx0XHR9ICk7XG5cdFx0cmV0dXJuIHByb21pc2U7XG5cdH1cblxuXHRmdW5jdGlvbiBzZWFyY2hJZEZyb21BUEkoIGlkICkge1xuXHRcdHZhciBwcm9taXNlID0gJGh0dHAuZ2V0KCBUTURCX0FQSS51cmwgKyAnbW92aWUvJyArIGlkLCB7XG5cdFx0XHRwYXJhbXM6IHsgYXBpX2tleTogVE1EQl9BUEkua2V5IH1cblx0XHR9ICkudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XG5cdFx0XHRsb2cuZGVidWcoICdhcGknLCAnc2VhcmNoQnlJZCA9PiBBUEk6JywgcmVzLmRhdGEgKTtcblx0XHRcdG1vdmllSWRDYWNoZS5wdXQoIHJlcy5kYXRhLmlkLCByZXMuZGF0YSApO1xuXHRcdFx0cHV0SXRlbVRvREIoIHJlcy5kYXRhICk7XG5cdFx0XHRyZXR1cm4gcmVzLmRhdGE7XG5cdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XG5cdFx0XHRsb2cuZGVidWcoICdlcnInLCAnc2VhcmNoQnlJZCA9PiBBUEk6JywgZXJyICk7XG5cdFx0fSApO1xuXHRcdHJldHVybiBwcm9taXNlO1xuXHR9XG5cblx0ZnVuY3Rpb24gc2VhcmNoQnlJZCggaWQgKSB7XG5cblx0XHR2YXIgZGZfREIgPSAkcS5kZWZlcigpO1xuXHRcdHZhciBkZl9SZXMgPSAkcS5kZWZlcigpO1xuXG5cdFx0dmFyIGNhY2hlZEl0ZW0gPSBtb3ZpZUlkQ2FjaGUuZ2V0KCBpZCApO1xuXHRcdGlmICggY2FjaGVkSXRlbSApIHtcblx0XHRcdGxvZy5kZWJ1ZyggJ2FwaScsICdzZWFyY2hCeUlkID0+IGNhY2hlOicsIGNhY2hlZEl0ZW0gKTtcblx0XHRcdGRmX1Jlcy5yZXNvbHZlKCBjYWNoZWRJdGVtICk7XG5cdFx0XHRyZXR1cm4gZGZfUmVzLnByb21pc2U7XG5cdFx0fVxuXG5cdFx0c2VhcmNoSWRGcm9tREIoIGlkICkudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XG5cdFx0XHRpZiAoIHJlcyApIHtcblx0XHRcdFx0ZGZfREIucmVzb2x2ZSggcmVzICk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRkZl9EQi5yZWplY3QoICdub3QgZm91bmQnICk7XG5cdFx0XHR9XG5cdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XG5cdFx0XHRcdGRmX0RCLnJlamVjdCggZXJyICk7XG5cdFx0fSApO1xuXG5cdFx0ZGZfREIucHJvbWlzZS50aGVuKCBmdW5jdGlvbiAoIHJlc19EQiApIHtcblx0XHRcdGRmX1Jlcy5yZXNvbHZlKCByZXNfREIgKTtcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcblx0XHRcdHNlYXJjaElkRnJvbUFQSSggaWQgKS50aGVuKCBmdW5jdGlvbiAoIHJlc19hcGkgKSB7XG5cdFx0XHRcdGRmX1Jlcy5yZXNvbHZlKCByZXNfYXBpICk7XG5cdFx0XHR9LCBmdW5jdGlvbiAoIGVycl9hcGkgKSB7XG5cdFx0XHRcdGRmX1Jlcy5yZWplY3QoIGVycl9hcGkgKTtcblx0XHRcdH0gKTtcblx0XHR9ICk7XG5cblx0XHRyZXR1cm4gZGZfUmVzLnByb21pc2U7XG5cblx0fVxuXG5cdGZ1bmN0aW9uIHNlYXJjaEJ5VGl0bGUoIHNlYXJjaE9iaiApIHtcblxuXHRcdGlmICggY3VyclBhZ2UgPiB0b3RhbFBhZ2VzICYmIHRvdGFsUGFnZXMgIT09IC0xICkge1xuXHRcdFx0Ly8gZW1pdCBldmVudCBlbmQgb2YgcGFnZVxuXHRcdFx0RVZULkVPUC5lbWl0KCk7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXG5cdFx0JGh0dHAuZ2V0KCBUTURCX0FQSS51cmwgKyAnc2VhcmNoL21vdmllJywge1xuXHRcdFx0Y2FjaGU6IHRydWUsXG5cdFx0XHRwYXJhbXM6IHtcblx0XHRcdFx0YXBpX2tleTogVE1EQl9BUEkua2V5LFxuXHRcdFx0XHRxdWVyeTogc2VhcmNoT2JqLnF1ZXJ5LFxuXHRcdFx0XHRwYWdlOiBjdXJyUGFnZVxuXHRcdFx0fVxuXHRcdH0gKVxuXHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcblx0XHRcdC8vIGVtaXQgZXZlbnQgc2VhcmNoIHN1Y2Nlc3Ncblx0XHRcdHNlYXJjaFJlc3VsdCA9IHNlYXJjaFJlc3VsdC5jb25jYXQoIHJlbW92ZU5vUG9zdGVySXRlbXMoIHJlcy5kYXRhLnJlc3VsdHMgKSApO1xuXHRcdFx0dG90YWxQYWdlcyA9IHJlcy5kYXRhLnRvdGFsX3BhZ2VzO1xuXHRcdFx0Y3VyclBhZ2UgKys7XG5cdFx0XHRsb2cuZGVidWcoICdhcGknLCAnc2VhcmNoQnlUaXRsZTonLCByZXMsIHJlcy5kYXRhICk7XG5cblx0XHRcdC8vIGNhY2hlXG5cdFx0XHRyZXMuZGF0YS5yZXN1bHRzLmZvckVhY2goIGZ1bmN0aW9uICggaXRlbSApIHtcblxuXHRcdFx0XHRpZiAoICFtb3ZpZUlkQ2FjaGUuZ2V0KCBpdGVtLmlkICkgKSB7XG5cdFx0XHRcdFx0bG9nLmRlYnVnKCAnYXBpJywgaXRlbS5pZCwgaXRlbSApO1xuXHRcdFx0XHRcdG1vdmllSWRDYWNoZS5wdXQoIGl0ZW0uaWQsIGl0ZW0gKTtcblx0XHRcdFx0fVxuXG5cdFx0XHR9ICk7XG5cblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcblx0XHRcdC8vIGVtaXQgZXZlbnQgc2VhcmNoIGVyclxuXHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ3NlYXJjaEJ5VGl0bGU6JywgZXJyICk7XG5cdFx0fSApO1xuXG5cdH1cblxuXHRmdW5jdGlvbiByZW1vdmVOb1Bvc3Rlckl0ZW1zKCByZXN1bHRzICkge1xuXHRcdHJldHVybiByZXN1bHRzLmZpbHRlciggZnVuY3Rpb24gKCBpdGVtICkge1xuXHRcdFx0cmV0dXJuICEhaXRlbS5wb3N0ZXJfcGF0aDtcblx0XHR9ICk7XG5cdH1cblxuXHRmdW5jdGlvbiBnZXRSZXMoKSB7XG5cdFx0cmV0dXJuIHNlYXJjaFJlc3VsdDtcblx0fVxuXG5cdGZ1bmN0aW9uIGNsZWFyU2VhcmNoKCkge1xuXHRcdC8vIGVtaXQgZXZlbnQgY2xlYXJTZWFjaFxuXHRcdHNlYXJjaFJlc3VsdC5sZW5ndGggPSAwO1xuXHRcdHRvdGFsUGFnZXMgPSAtMTtcblx0XHRjdXJyUGFnZSA9IDE7XG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdHNlYXJjaEJ5VGl0bGUsXG5cdFx0c2VhcmNoQnlJZCxcblx0XHRjbGVhclNlYXJjaCxcblx0XHRnZXRSZXMsXG5cdFx0cHV0SXRlbVRvREIsXG5cdFx0bW92aWVJZENhY2hlXG5cdH07XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJ0VORFBPSU5UX1VSSScsICckaHR0cCcsICckcScsICdhdXRoVG9rZW4nLFxuZnVuY3Rpb24gKCBsb2csIEVORFBPSU5UX1VSSSwgJGh0dHAsICRxLCBhdXRoVG9rZW4gKSB7XG5cblx0XHR2YXIgaWRlbnRpdHkgPSBudWxsO1xuXHRcdHZhciBfaWRlbnRpdHlSZXNvbHZlZCA9IGZhbHNlO1xuXG5cdFx0ZnVuY3Rpb24gYXV0aG9yaXplKCBmb3JjZSApIHtcblxuXHRcdFx0dmFyIGRlZmVycmVkID0gJHEuZGVmZXIoKTtcblxuXHRcdFx0aWYgKCBmb3JjZSApIGlkZW50aXR5ID0gbnVsbDtcblxuXHRcdFx0aWYgKCBpZGVudGl0eSAhPT0gbnVsbCApIHtcblxuXHRcdFx0XHRkZWZlcnJlZC5yZXNvbHZlKCB0cnVlICk7XG5cblx0XHRcdH0gZWxzZSB7XG5cblx0XHRcdFx0JGh0dHAuZ2V0KCBFTkRQT0lOVF9VUkkgKyAnYXV0aCcsIHsgcmVxdWlyZUF1dGg6IHRydWUgfSApXG5cdFx0XHRcdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xuXG5cdFx0XHRcdFx0XHRsb2cuZGVidWcoICdhdXRoJywgJ2F1dGguYXV0aG9yaXplKCk6JywgcmVzLCByZXMuZGF0YSApO1xuXHRcdFx0XHRcdFx0aWRlbnRpdHkgPSByZXMuZGF0YTtcblx0XHRcdFx0XHRcdF9pZGVudGl0eVJlc29sdmVkID0gdHJ1ZTtcblx0XHRcdFx0XHRcdGRlZmVycmVkLnJlc29sdmUoIHRydWUgKTtcblxuXHRcdFx0XHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xuXG5cdFx0XHRcdFx0XHRsb2cuZGVidWcoICdlcnInLCAnYXV0aG9yaXplJywgZXJyLCBlcnIuZGF0YSApO1xuXHRcdFx0XHRcdFx0Ly8gdG9kbyBpZiBqd3QgZXhwaXJlZCAsIGRlYXV0aG9yaXplLCByZW1vdmUgbG9jYWwgc3RvcmFnZSwgcmVkaXJlY3Rcblx0XHRcdFx0XHRcdF9pZGVudGl0eVJlc29sdmVkID0gdHJ1ZTtcblx0XHRcdFx0XHRcdGRlZmVycmVkLnJlamVjdCggZXJyICk7XG5cblx0XHRcdFx0XHR9ICk7XG5cblx0XHRcdH1cblxuXHRcdFx0cmV0dXJuIGRlZmVycmVkLnByb21pc2U7XG5cblx0XHR9XG5cblx0XHRmdW5jdGlvbiBkZWF1dGhvcml6ZSgpIHtcblx0XHRcdGF1dGhUb2tlbi5yZW1vdmVUb2tlbigpO1xuXHRcdFx0aWRlbnRpdHkgPSBudWxsO1xuXHRcdH1cblxuXHRcdGZ1bmN0aW9uIGlzQXV0aGVudGljYXRlZCgpIHtcblx0XHRcdHJldHVybiBpZGVudGl0eSAhPT0gbnVsbDtcblx0XHR9XG5cblx0XHRmdW5jdGlvbiBpZGVudGl0eVJlc29sdmVkKCkge1xuXHRcdFx0cmV0dXJuIF9pZGVudGl0eVJlc29sdmVkO1xuXHRcdH1cblxuXHRcdHJldHVybiB7XG5cblx0XHRcdGF1dGhvcml6ZSxcblx0XHRcdGRlYXV0aG9yaXplLFxuXHRcdFx0aXNBdXRoZW50aWNhdGVkLFxuXHRcdFx0aWRlbnRpdHlSZXNvbHZlZFxuXG5cdFx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdhdXRoVG9rZW4nLCBmdW5jdGlvbiAoIGF1dGhUb2tlbiApIHtcblxuXHRmdW5jdGlvbiByZXF1ZXN0KCBjb25maWcgKSB7XG5cblx0XHRpZiAoIGNvbmZpZy5yZXF1aXJlQXV0aCApIHtcblx0XHRcdHZhciB0b2tlbiA9IGF1dGhUb2tlbi5nZXRUb2tlbigpO1xuXHRcdFx0aWYgKCB0b2tlbiApIHtcblx0XHRcdFx0Ly8gaHR0cDovL3NlbGYtaXNzdWVkLmluZm8vZG9jcy9kcmFmdC1pZXRmLW9hdXRoLXYyLWJlYXJlci5odG1sICAgc2VjdGlvbiAyLjFcblx0XHRcdFx0Ly8gaHR0cHM6Ly9kZXZlbG9wZXJzLmdvb2dsZS5jb20vZ21haWwvbWFya3VwL2FjdGlvbnMvdmVyaWZ5aW5nLWJlYXJlci10b2tlbnNcblx0XHRcdFx0Ly8gaHR0cDovL3d3dy53My5vcmcvUHJvdG9jb2xzL3JmYzI2MTYvcmZjMjYxNi1zZWM0Lmh0bWwgc2VjdGlvbiA0LjIgaGVhZGVyIGZpZWxkIG5hbWUgY2FzZSBpbnNlbnNpdGl2ZVxuXHRcdFx0XHRjb25maWcuaGVhZGVycy5BdXRob3JpemF0aW9uID0gJ0JlYXJlciAnICsgdG9rZW47XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0cmV0dXJuIGNvbmZpZztcblxuXHR9XG5cblx0ZnVuY3Rpb24gcmVzcG9uc2UoIHJlcyApIHtcblx0XHRyZXR1cm4gcmVzO1xuXHR9XG5cblx0cmV0dXJuIHtcblxuXHRcdHJlcXVlc3QsXG5cdFx0cmVzcG9uc2VcblxuXHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckd2luZG93JywgZnVuY3Rpb24gKCBsb2csICR3aW5kb3cgKSB7XG5cblx0dmFyIHN0b3JhZ2UgPSAkd2luZG93LmxvY2FsU3RvcmFnZTtcblx0dmFyIGNhY2hlZFRva2VuID0gbnVsbDtcblxuXHRmdW5jdGlvbiBzZXRUb2tlbiggdG9rZW4gKSB7XG5cdFx0Y2FjaGVkVG9rZW4gPSB0b2tlbjtcblx0XHRzdG9yYWdlLnNldEl0ZW0oICdqd3QnLCB0b2tlbiApO1xuXHR9XG5cblx0ZnVuY3Rpb24gZ2V0VG9rZW4oKSB7XG5cdFx0aWYgKCAhY2FjaGVkVG9rZW4gKSB7XG5cdFx0XHRjYWNoZWRUb2tlbiA9IHN0b3JhZ2UuZ2V0SXRlbSggJ2p3dCcgKTtcblx0XHR9XG5cdFx0cmV0dXJuIGNhY2hlZFRva2VuO1xuXHR9XG5cblx0ZnVuY3Rpb24gcmVtb3ZlVG9rZW4oKSB7XG5cdFx0Y2FjaGVkVG9rZW4gPSBudWxsO1xuXHRcdHN0b3JhZ2UucmVtb3ZlSXRlbSggJ2p3dCcgKTtcblx0XHRsb2cuZGVidWcoICdhdXRoJywgJ3Rva2VuIHJlbW92ZWQnICk7XG5cdH1cblxuXHRmdW5jdGlvbiBoYXNUb2tlbigpIHtcblx0XHRyZXR1cm4gISFnZXRUb2tlbigpO1xuXHR9XG5cblx0cmV0dXJuIHtcblxuXHRcdHNldFRva2VuLFxuXHRcdGdldFRva2VuLFxuXHRcdHJlbW92ZVRva2VuLFxuXHRcdGhhc1Rva2VuXG5cblx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJyRodHRwJywgJ0VORFBPSU5UX1VSSScsICdhdXRoVG9rZW4nLCAnJHN0YXRlJyxcbmZ1bmN0aW9uICggbG9nLCAkc2NvcGUsICRodHRwLCBFTkRQT0lOVF9VUkksIGF1dGhUb2tlbiwgJHN0YXRlICkgIHtcblxuXHR2YXIgdm0gPSB0aGlzO1xuXHR2bS51c2VyID0ge1xuXHRcdGVtYWlsOiAnJyxcblx0XHRwYXNzd29yZDogJydcblx0fTtcblxuXHR2bS5zaWduaW4gPSBmdW5jdGlvbigpIHtcblxuXHRcdGlmICggdm0udXNlci5lbWFpbCA9PT0gJycgfHwgdm0udXNlci5wYXNzd29yZCA9PT0gJycgKSB7XG5cdFx0XHRsb2cuZGVidWcoICdhdXRoJywgJ2VtYWlsICYgcGFzc3dvcmQgcmVxdWlyZWQuJyApO1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblxuXHRcdCRodHRwLnBvc3QoIEVORFBPSU5UX1VSSSArICdzaWduaW4nLCB2bS51c2VyIClcblx0XHRcdC50aGVuKCBmdW5jdGlvbiggcmVzICkge1xuXHRcdFx0XHRsb2cuZGVidWcoICdhdXRoJywgJ3NpZ25pbicsIHJlcywgcmVzLmRhdGEgKTtcblx0XHRcdFx0YXV0aFRva2VuLnNldFRva2VuKCByZXMuZGF0YS50b2tlbiApO1xuXHRcdFx0XHQkc3RhdGUuZ28oICdjb2xsZWN0aW9uJyApO1xuXHRcdFx0fSwgZnVuY3Rpb24oIGVyciwgc3RhdHVzICkge1xuXHRcdFx0XHRsb2cuZGVidWcoICdlcnInLCAnc2lnbmluJywgZXJyICk7XG5cdFx0XHR9ICk7XG5cblx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckc3RhdGUnLCAnYXV0aCcsICdtb3ZpZUNvbGxlY3Rpb24nLCBmdW5jdGlvbiAoICRzdGF0ZSwgYXV0aCwgbW92aWVDb2xsZWN0aW9uICkgIHtcblxuXHRhdXRoLmRlYXV0aG9yaXplKCk7XG5cdG1vdmllQ29sbGVjdGlvbi5fY2xlYXIoKTtcblx0JHN0YXRlLmdvKCAnc2lnbmluJyApO1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckc2NvcGUnLCAnJGh0dHAnLCAnRU5EUE9JTlRfVVJJJywgJ2F1dGhUb2tlbicsICckc3RhdGUnLFxuZnVuY3Rpb24gKCBsb2csICRzY29wZSwgJGh0dHAsIEVORFBPSU5UX1VSSSwgYXV0aFRva2VuLCAkc3RhdGUgKSB7XG5cblx0XHR2YXIgdm0gPSB0aGlzO1xuXHRcdHZtLnVzZXIgPSB7fTtcblxuXHRcdHZtLnNpZ251cCA9IGZ1bmN0aW9uICgpIHtcblxuXHRcdFx0aWYgKCB2bS51c2VyLmVtYWlsID09PSB1bmRlZmluZWQgfHwgdm0udXNlci5wYXNzd29yZCA9PT0gdW5kZWZpbmVkICkge1xuXHRcdFx0XHRsb2cuZGVidWcoICd3YXJuJywgJ2VtYWlsICYgcGFzc3dvcmQgcmVxdWlyZWQuJyApO1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cblx0XHRcdGxvZy5kZWJ1ZyggJ2F1dGgnLCAnc2lnbmluZyB1cC4uLicgKTtcblx0XHRcdCRodHRwLnBvc3QoIEVORFBPSU5UX1VSSSArICdzaWdudXAnLCB2bS51c2VyIClcblx0XHRcdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xuXG5cdFx0XHRcdFx0bG9nLmRlYnVnKCAnYXV0aCcsICdSZWdpc3RlcmVkLicsIHJlcyApO1xuXG5cdFx0XHRcdFx0YXV0aFRva2VuLnNldFRva2VuKCByZXMuZGF0YS50b2tlbiApO1xuXHRcdFx0XHRcdCRzdGF0ZS5nbyggJ2NvbGxlY3Rpb24nICk7XG5cblx0XHRcdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XG5cblx0XHRcdFx0XHRsb2cuZGVidWcoICdlcnInLCBlcnIgKTtcblx0XHRcdFx0XHR2bS5mb3JtLiRzdWJtaXR0ZWQgPSBmYWxzZTtcblxuXHRcdFx0XHR9ICk7XG5cblx0XHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyRyb290U2NvcGUnLCBmdW5jdGlvbiAoICRyb290U2NvcGUgKSB7XG5cblx0dmFyIEVWVCA9IHtcblxuXHRcdEVPUDoge1xuXHRcdFx0bGlzdGVuOiBmdW5jdGlvbiAoIGNiICkgeyAkcm9vdFNjb3BlLiRvbiggJ0VPUCcsIGNiICk7IH0sXG5cdFx0XHRlbWl0OiBmdW5jdGlvbiAoKSB7ICRyb290U2NvcGUuJGJyb2FkY2FzdCggJ0VPUCcgKTsgfVxuXHRcdH0sXG5cdFx0Y29sbGVjdGlvbk1vZGFsT3Blbjoge1xuXHRcdFx0bGlzdGVuOiBmdW5jdGlvbiAoIGNiICkgeyAkcm9vdFNjb3BlLiRvbiggJ2NvbGxlY3Rpb25Nb2RhbE9wZW4nLCBjYiApOyB9LFxuXHRcdFx0ZW1pdDogZnVuY3Rpb24gKCkgeyAkcm9vdFNjb3BlLiRicm9hZGNhc3QoICdjb2xsZWN0aW9uTW9kYWxPcGVuJyApOyB9XG5cdFx0fSxcblx0XHRjb2xsZWN0aW9uTW9kYWxDbG9zZToge1xuXHRcdFx0bGlzdGVuOiBmdW5jdGlvbiAoIGNiICkgeyAkcm9vdFNjb3BlLiRvbiggJ2NvbGxlY3Rpb25Nb2RhbENsb3NlJywgY2IgKTsgfSxcblx0XHRcdGVtaXQ6IGZ1bmN0aW9uICgpIHsgJHJvb3RTY29wZS4kYnJvYWRjYXN0KCAnY29sbGVjdGlvbk1vZGFsQ2xvc2UnICk7IH1cblx0XHR9XG5cblx0fTtcblxuXHRyZXR1cm4gRVZUO1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgZnVuY3Rpb24gKCkge1xuXG5cdHZhciBkZWJ1Z0VuYWJsZWQgPSBmYWxzZTtcblx0dmFyIGRlYnVnTmFtZXNwYWNlcyA9IFtdO1xuXG5cdHRoaXMuZW5hYmxlRGVidWcgPSBmdW5jdGlvbiAoKSB7XG5cdFx0ZGVidWdFbmFibGVkID0gdHJ1ZTtcblx0fTtcblxuXHR0aGlzLmVuYWJsZURlYnVnTmFtZXNwYWNlID0gZnVuY3Rpb24gKCkge1xuXHRcdGZvciAoIGxldCBpID0gMDsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7IGkrKyApIHtcblx0XHRcdGRlYnVnTmFtZXNwYWNlcy5wdXNoKCBhcmd1bWVudHNbIGkgXSApO1xuXHRcdH1cblx0fTtcblxuXHR0aGlzLiRnZXQgPSAoKSA9PiB7XG5cblx0XHRmdW5jdGlvbiBkZWJ1ZygpIHtcblx0XHRcdGlmICggIWRlYnVnRW5hYmxlZCApIHJldHVybjtcblx0XHRcdHZhciBkZWJ1Z05hbWUgPSBhcmd1bWVudHNbIDAgXTtcblx0XHRcdHZhciBzbGljZWRBcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoIGFyZ3VtZW50cywgMSApO1xuXHRcdFx0aWYgKCBkZWJ1Z05hbWUgPT09ICdlcnInICkge1xuXHRcdFx0XHRjb25zb2xlLmVycm9yLmFwcGx5KCBjb25zb2xlLCBzbGljZWRBcmdzICk7XG5cdFx0XHR9IGVsc2UgaWYgKCBkZWJ1Z05hbWUgPT09ICdpbmZvJyApIHtcblx0XHRcdFx0Y29uc29sZS5pbmZvLmFwcGx5KCBjb25zb2xlLCBzbGljZWRBcmdzICk7XG5cdFx0XHR9IGVsc2UgaWYgKCBkZWJ1Z05hbWUgPT09ICd3YXJuJyApIHtcblx0XHRcdFx0Y29uc29sZS53YXJuLmFwcGx5KCBjb25zb2xlLCBzbGljZWRBcmdzICk7XG5cdFx0XHR9IGVsc2UgaWYgKCBkZWJ1Z05hbWVzcGFjZXMuaW5kZXhPZiggZGVidWdOYW1lICkgIT09IC0xICkge1xuXHRcdFx0XHRjb25zb2xlLmxvZy5hcHBseSggY29uc29sZSwgWyBkZWJ1Z05hbWUgXS5jb25jYXQoIHNsaWNlZEFyZ3MgKSApO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdHJldHVybiB7XG5cdFx0XHRkZWJ1Z1xuXHRcdH07XG5cblx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbIGZ1bmN0aW9uICgpIHtcblxuXHRmdW5jdGlvbiBkZWJvdW5jZSggZnVuYywgd2FpdCwgaW1tZWRpYXRlICkge1xuXHRcdHZhciBfdGhpcyA9IHRoaXMsXG5cdFx0XHRfYXJndW1lbnRzID0gYXJndW1lbnRzO1xuXG5cdFx0dmFyIHRpbWVvdXQ7XG5cdFx0cmV0dXJuIGZ1bmN0aW9uICgpIHtcblxuXHRcdFx0dmFyIGNvbnRleHQgPSBfdGhpcyxcblx0XHRcdFx0YXJncyA9IF9hcmd1bWVudHM7XG5cdFx0XHR2YXIgbGF0ZXIgPSBmdW5jdGlvbiBsYXRlcigpIHtcblxuXHRcdFx0XHR0aW1lb3V0ID0gbnVsbDtcblx0XHRcdFx0aWYgKCAhaW1tZWRpYXRlICkgZnVuYy5hcHBseSggY29udGV4dCwgYXJncyApO1xuXHRcdFx0fTtcblx0XHRcdHZhciBjYWxsTm93ID0gaW1tZWRpYXRlICYmICF0aW1lb3V0O1xuXHRcdFx0Y2xlYXJUaW1lb3V0KCB0aW1lb3V0ICk7XG5cdFx0XHR0aW1lb3V0ID0gc2V0VGltZW91dCggbGF0ZXIsIHdhaXQgKTtcblx0XHRcdGlmICggY2FsbE5vdyApIGZ1bmMuYXBwbHkoIGNvbnRleHQsIGFyZ3MgKTtcblx0XHR9O1xuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRkZWJvdW5jZVxuXHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyRodHRwUHJvdmlkZXInLCBmdW5jdGlvbiAoICRodHRwUHJvdmlkZXIgKSB7XG5cdCRodHRwUHJvdmlkZXIuaW50ZXJjZXB0b3JzLnB1c2goICdhdXRoSW50ZXJjZXB0b3InICk7XG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZ1Byb3ZpZGVyJywgJyRodHRwUHJvdmlkZXInLCBmdW5jdGlvbiAoIGxvZ1Byb3ZpZGVyLCAkaHR0cFByb3ZpZGVyICkge1xuXG5cdGxvZ1Byb3ZpZGVyLmVuYWJsZURlYnVnKCk7XG5cdC8vIGxvZ1Byb3ZpZGVyLmVuYWJsZURlYnVnTmFtZXNwYWNlKCAnaW5mbycsICdlcnInLCAnYXV0aCcsICdhcGknLCAnY29sbGVjdGlvbicgKTtcblx0bG9nUHJvdmlkZXIuZW5hYmxlRGVidWdOYW1lc3BhY2UoICdpbmZvJywgJ2VycicgKTtcblxuXHQkaHR0cFByb3ZpZGVyLnVzZUxlZ2FjeVByb21pc2VFeHRlbnNpb25zKCBmYWxzZSApO1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyRzdGF0ZVByb3ZpZGVyJywgJyR1cmxSb3V0ZXJQcm92aWRlcicsICckaHR0cFByb3ZpZGVyJyxcbmZ1bmN0aW9uICggJHN0YXRlUHJvdmlkZXIsICR1cmxSb3V0ZXJQcm92aWRlciwgJGh0dHBQcm92aWRlciApIHtcblxuXHQkdXJsUm91dGVyUHJvdmlkZXIub3RoZXJ3aXNlKCAnLycgKTtcblxuXHQkc3RhdGVQcm92aWRlclxuXHRcdC5zdGF0ZSggJ2hlbGl4Jywge1xuXHRcdFx0dXJsOiAnLycsXG5cdFx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvaGVsaXguaHRtbCdcblx0XHR9IClcblx0XHQuc3RhdGUoICdzaWdudXAnLCB7XG5cdFx0XHR1cmw6ICcvc2lnbnVwJyxcblx0XHRcdHRlbXBsYXRlVXJsOiAnLi90ZW1wbGF0ZS9zaWdudXAuaHRtbCcsXG5cdFx0XHRjb250cm9sbGVyOiAnc2lnbnVwQ3RybCcsXG5cdFx0XHRjb250cm9sbGVyQXM6ICdzaWdudXAnXG5cdFx0fSApXG5cdFx0LnN0YXRlKCAnc2lnbmluJywge1xuXHRcdFx0dXJsOiAnL3NpZ25pbicsXG5cdFx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvc2lnbmluLmh0bWwnLFxuXHRcdFx0Y29udHJvbGxlcjogJ3NpZ25pbkN0cmwnLFxuXHRcdFx0Y29udHJvbGxlckFzOiAnc2lnbmluJ1xuXHRcdH0gKVxuXHRcdC5zdGF0ZSggJ3NpZ25vdXQnLCB7XG5cdFx0XHR1cmw6ICcvc2lnbm91dCcsXG5cdFx0XHRjb250cm9sbGVyOiAnc2lnbm91dEN0cmwnXG5cdFx0fSApXG5cdFx0LnN0YXRlKCAnbW92aWVEZXRhaWwnLCB7XG5cdFx0XHR1cmw6ICcvbW92aWUvOm1vdmllSWQnLFxuXHRcdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL21vdmllRGV0YWlsLmh0bWwnLFxuXHRcdFx0Y29udHJvbGxlcjogJ21vdmllRGV0YWlsQ3RybCcsXG5cdFx0XHRjb250cm9sbGVyQXM6ICdtZCcsXG5cdFx0XHRyZXNvbHZlOiB7XG5cdFx0XHRcdG1vdmllSXRlbTogWyAnJHN0YXRlUGFyYW1zJywgJ1RNRGInLCBmdW5jdGlvbiAoICRzdGF0ZVBhcmFtcywgVE1EYiApIHtcblx0XHRcdFx0XHRyZXR1cm4gVE1EYi5zZWFyY2hCeUlkKCAkc3RhdGVQYXJhbXMubW92aWVJZCApO1xuXHRcdFx0XHR9IF1cblx0XHRcdH1cblx0XHR9IClcblx0XHQuc3RhdGUoJ2NvbGxlY3Rpb24nLCB7XG5cdFx0XHR1cmw6ICcvY29sbGVjdGlvbicsXG5cdFx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvY29sbGVjdGlvbi5odG1sJyxcblx0XHRcdGNvbnRyb2xsZXI6ICdtb3ZpZUNvbGxlY3Rpb25DdHJsJyxcblx0XHRcdGNvbnRyb2xsZXJBczogJ21jJyxcblx0XHRcdHJlc29sdmU6IHtcblx0XHRcdFx0YXV0aG9yaXplOiBbICdhdXRoJywgZnVuY3Rpb24gKCBhdXRoICkge1xuXHRcdFx0XHRcdHJldHVybiBhdXRoLmF1dGhvcml6ZSgpO1xuXHRcdFx0XHR9IF0sXG5cdFx0XHRcdHJlc29sdmVkQ29sbGVjdGlvbjogWyAnbW92aWVDb2xsZWN0aW9uJywgZnVuY3Rpb24gKCBtb3ZpZUNvbGxlY3Rpb24gKSB7XG5cdFx0XHRcdFx0cmV0dXJuIG1vdmllQ29sbGVjdGlvbi5yZXNvbHZlQ29sbGVjdGlvbigpO1xuXHRcdFx0XHR9IF1cblx0XHRcdH1cblx0XHR9KVxuXHQ7XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyBmdW5jdGlvbiAoKSB7XG5cblx0ZnVuY3Rpb24gbGluayggJHNjb3BlLCAkZWxlbWVudCwgJGF0dHJzICkge1xuXG5cdFx0JGVsZW1lbnRcblx0XHQub24oICdtb3VzZWVudGVyJywgZnVuY3Rpb24gKCkge1xuXHRcdFx0JGVsZW1lbnQucmVtb3ZlQ2xhc3MoICRhdHRycy5sZWF2ZSApO1xuXHRcdFx0JGVsZW1lbnQuYWRkQ2xhc3MoICRhdHRycy5ob3ZlciApO1xuXHRcdH0gKVxuXHRcdC5vbiggJ21vdXNlbGVhdmUnLCBmdW5jdGlvbiAoKSB7XG5cdFx0XHQkZWxlbWVudC5yZW1vdmVDbGFzcyggJGF0dHJzLmhvdmVyICk7XG5cdFx0XHQkZWxlbWVudC5hZGRDbGFzcyggJGF0dHJzLmxlYXZlICk7XG5cdFx0fSApO1xuXG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdHJlc3RyaWN0OiAnQScsXG5cdFx0bGluazogbGlua1xuXHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyR3aW5kb3cnLCAnRU5HSU5FJywgJ3V0aWwnLCBmdW5jdGlvbiAoICR3aW5kb3csIEVOR0lORSwgdXRpbCApIHtcblxuXHRmdW5jdGlvbiBjdHJsKCAkc2NvcGUsICRlbGVtZW50ICkge1xuXG5cdFx0RU5HSU5FLmF0dGFjaFJlbmRlcmVyKCAkZWxlbWVudCApO1xuXHRcdCQoICR3aW5kb3cgKS5vbiggJ3Jlc2l6ZScsIHV0aWwuZGVib3VuY2UoIEVOR0lORS5vbldpbmRvd1Jlc2l6ZSwgMTAwICkgKTtcblx0XHQkZWxlbWVudC5vbiggJ3doZWVsJywgZnVuY3Rpb24gKCBldnQgKSB7XG5cdFx0XHRFTkdJTkUuJCQud2hlZWxfZHkgPSAtTWF0aC5zaWduKCBldnQub3JpZ2luYWxFdmVudC5kZWx0YVkgKTtcblx0XHR9ICk7XG5cblx0XHRFTkdJTkUuc3RhcnQoKTtcblxuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRyZXN0cmljdDogJ0UnLFxuXHRcdHJlcGxhY2U6IHRydWUsXG5cdFx0Y29udHJvbGxlcjogY3RybCxcblx0XHR0ZW1wbGF0ZTogJzxkaXYgaWQ9XCJjYW52YXMtY29udGFpbmVyXCI+PC9kaXY+J1xuXHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyR3aW5kb3cnLCBmdW5jdGlvbiAoICR3aW5kb3cgKSB7XG5cblx0dmFyICQkID0ge1xuXHRcdGNhbnZhczogbnVsbCxcblx0XHRzdGF0czogbmV3IFN0YXRzKCksXG5cdFx0c2NlbmU6IG5ldyBUSFJFRS5TY2VuZSgpLFxuXHRcdHdpZHRoOiAkKHdpbmRvdykud2lkdGgoKSxcblx0XHRoZWlnaHQ6ICQod2luZG93KS5oZWlnaHQoKSxcblx0XHRjYW1lcmE6IG5ldyBUSFJFRS5QZXJzcGVjdGl2ZUNhbWVyYSggNzAsIHRoaXMud2lkdGggLyB0aGlzLmhlaWdodCwgMTAsIDEwMDAwMCApLFxuXHRcdHJlbmRlcmVyOiBuZXcgVEhSRUUuQ1NTM0RSZW5kZXJlcigpLFxuXHRcdHNjcmVlbl9yYXRpbzogdGhpcy53aWR0aCAvIHRoaXMuaGVpZ2h0LFxuXHRcdHBpeGVsX3JhdGlvOiAkd2luZG93LmRldmljZVBpeGVsUmF0aW8gfHwgMSxcblx0XHRtb3VzZV94OiB0aGlzLndpZHRoICogMC41LFxuXHRcdG1vdXNlX3k6IHRoaXMuaGVpZ2h0ICogMC41LFxuXHRcdHdoZWVsX2R5OiAwXG5cdH07XG5cblx0JCQucmVuZGVyZXIuc2V0U2l6ZSggJCQud2lkdGgsICQkLmhlaWdodCApO1xuXG5cdGZ1bmN0aW9uIGF0dGFjaFJlbmRlcmVyKCBjYW52YXMgKSB7XG5cdFx0JCQuY2FudmFzID0gY2FudmFzO1xuXHRcdGNhbnZhcy5hcHBlbmQoICQkLnJlbmRlcmVyLmRvbUVsZW1lbnQgKTtcblx0XHRjYW52YXMuYXBwZW5kKCAkJC5zdGF0cy5kb21FbGVtZW50ICk7XG5cdH1cblxuXHRmdW5jdGlvbiBvbldpbmRvd1Jlc2l6ZSgpIHtcblx0XHQkJC53aWR0aCA9ICQod2luZG93KS53aWR0aCgpO1xuXHRcdCQkLmhlaWdodCA9ICQod2luZG93KS5oZWlnaHQoKTtcblx0XHQkJC5waXhlbF9yYXRpbyA9ICR3aW5kb3cuZGV2aWNlUGl4ZWxSYXRpbyB8fCAxO1xuXHRcdCQkLnNjcmVlbl9yYXRpbyA9ICQkLndpZHRoIC8gJCQuaGVpZ2h0O1xuXHRcdCQkLmNhbWVyYS5hc3BlY3QgPSAkJC5zY3JlZW5fcmF0aW87XG5cdFx0JCQuY2FtZXJhLnVwZGF0ZVByb2plY3Rpb25NYXRyaXgoKTtcblx0XHQkJC5yZW5kZXJlci5zZXRTaXplKCAkJC53aWR0aCwgJCQuaGVpZ2h0ICk7XG5cdH1cblxuXHRmdW5jdGlvbiBzZXR1cCgpIHtcblxuXHR9XG5cblx0ZnVuY3Rpb24gdXBkYXRlKCkge1xuXG5cdFx0aWYgKCBNYXRoLmFicyggJCQud2hlZWxfZHkgKSA+IDAuMDAxICkge1xuXHRcdFx0JCQuY2FtZXJhLnBvc2l0aW9uLnkgKz0gJCQud2hlZWxfZHkgKiAxLjA7XG5cdFx0XHQkJC5jYW1lcmEucm90YXRlWSggJCQud2hlZWxfZHkgKiAwLjAyNSApO1xuXHRcdFx0JCQud2hlZWxfZHkgKj0gMC45NTtcblx0XHR9XG5cblx0fVxuXG5cdC8vIC0tLS0gIGRyYXcgbG9vcFxuXHRmdW5jdGlvbiBydW4oKSB7XG5cblx0XHRyZXF1ZXN0QW5pbWF0aW9uRnJhbWUoIHJ1biApO1xuXHRcdHVwZGF0ZSgpO1xuXHRcdCQkLnJlbmRlcmVyLnJlbmRlciggJCQuc2NlbmUsICQkLmNhbWVyYSApO1xuXHRcdCQkLnN0YXRzLnVwZGF0ZSgpO1xuXG5cdH1cblxuXHRmdW5jdGlvbiBzdGFydCgpIHtcblx0XHRzZXR1cCgpO1xuXHRcdHJ1bigpO1xuXHR9XG5cblx0ZnVuY3Rpb24gcmVzZXRDYW1lcmEoKSB7XG5cdFx0JCQuY2FtZXJhLnBvc2l0aW9uLnNldCggMCwgMCwgMCApO1xuXHRcdCQkLmNhbWVyYS5yb3RhdGlvbi5zZXQoIDAsIDAsIDAgKTtcblx0fVxuXG5cdHJldHVybiB7XG5cdFx0JCQsXG5cdFx0YXR0YWNoUmVuZGVyZXIsXG5cdFx0b25XaW5kb3dSZXNpemUsXG5cdFx0c3RhcnQsXG5cdFx0cmVzZXRDYW1lcmEsXG5cdH07XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJ0VOR0lORScsICckY29tcGlsZScsICckcm9vdFNjb3BlJyxcbmZ1bmN0aW9uICggbG9nLCBFTkdJTkUsICRjb21waWxlLCAkcm9vdFNjb3BlICkge1xuXG5cdHZhciBhbGxQb3N0ZXJzID0gbmV3IFRIUkVFLk9iamVjdDNEKCk7XG5cdEVOR0lORS4kJC5zY2VuZS5hZGQoIGFsbFBvc3RlcnMgKTtcblxuXHRmdW5jdGlvbiBtYWtlSGVsaXhQb3N0ZXJzKCBwb3N0ZXJPYmplY3RNdWx0aSwgb2Zmc2V0U3RhcnRJZHggKSB7XG5cblx0XHR2YXIgdmVjdG9yID0gbmV3IFRIUkVFLlZlY3RvcjMoKTtcblx0XHR2YXIgcmFkaXVzID0gOTAwO1xuXHRcdGZvciAoIHZhciBpID0gMDsgaSA8IHBvc3Rlck9iamVjdE11bHRpLmxlbmd0aDsgaSsrICkge1xuXG5cdFx0XHR2YXIgJGlzb2xhdGVkU2NvcGUgPSAkcm9vdFNjb3BlLiRuZXcoIHRydWUgKTtcblx0XHRcdCRpc29sYXRlZFNjb3BlLm1vdmllSXRlbSA9IHBvc3Rlck9iamVjdE11bHRpWyBpIF07XG5cblx0XHRcdHZhciBwb3N0ZXJEaXJlY3RpdmVFbGVtID0gJGNvbXBpbGUoICc8cG9zdGVyPjwvcG9zdGVyPicgKSggJGlzb2xhdGVkU2NvcGUgKVsgMCBdO1xuXHRcdFx0dmFyIGNzczNkT2JqID0gbmV3IFRIUkVFLkNTUzNET2JqZWN0KCBwb3N0ZXJEaXJlY3RpdmVFbGVtICk7XG5cblx0XHRcdC8vIHRhZyBhbG9nIGFuIGlzb2xhdGVkU2NvcGUgdG8gYmUgZGVzdHJveSB3aGVuIGRpc3Bvc2UgYW4gZWxlbWVudFxuXHRcdFx0Y3NzM2RPYmouc2NvcGUgPSAkaXNvbGF0ZWRTY29wZTtcblxuXHRcdFx0dmFyIGhpZHggPSBpICsgb2Zmc2V0U3RhcnRJZHg7XG5cdFx0XHR2YXIgcGhpID0gaGlkeCAqIDAuMTc1ICsgTWF0aC5QSTtcblx0XHRcdGNzczNkT2JqLnBvc2l0aW9uLnggPSAtIHJhZGl1cyAqIE1hdGguc2luKCBwaGkgKTtcblx0XHRcdGNzczNkT2JqLnBvc2l0aW9uLnkgPSAtICggaGlkeCAqIDggKSArIDIwMDtcblx0XHRcdGNzczNkT2JqLnBvc2l0aW9uLnogPSByYWRpdXMgKiBNYXRoLmNvcyggcGhpICk7XG5cblx0XHRcdHZlY3Rvci5zZXQoIC1jc3MzZE9iai5wb3NpdGlvbi54ICogMiwgY3NzM2RPYmoucG9zaXRpb24ueSwgLWNzczNkT2JqLnBvc2l0aW9uLnogKiAyICk7XG5cblx0XHRcdGNzczNkT2JqLmxvb2tBdCggdmVjdG9yICk7XG5cdFx0XHRhbGxQb3N0ZXJzLmFkZCggY3NzM2RPYmogKTtcblxuXHRcdH1cblxuXHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnY3VyciBwb3N0ZXJzOicsIGFsbFBvc3RlcnMuY2hpbGRyZW4ubGVuZ3RoICk7XG5cblx0fVxuXG5cdGZ1bmN0aW9uIGNsZWFyQWxsKCkge1xuXHRcdGFsbFBvc3RlcnMuY2hpbGRyZW4uZm9yRWFjaCggZnVuY3Rpb24gKCBwb3N0ZXIgKSB7XG5cdFx0XHRwb3N0ZXIuZGlzcG9zZUVsZW1lbnQoKTtcblx0XHRcdHBvc3Rlci5zY29wZS4kZGVzdHJveSgpO1xuXHRcdH0gKTtcblx0XHRhbGxQb3N0ZXJzLmNoaWxkcmVuLmxlbmd0aCA9IDA7IC8vIGNsZWFyIGl0ZW1zXG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdG1ha2VIZWxpeFBvc3RlcnMsXG5cdFx0Y2xlYXJBbGxcblx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckc3RhdGUnLCAnY29sbGVjdGlvbk1vZGFsU2VydmljZScsIGZ1bmN0aW9uICggJHN0YXRlLCBjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlICkge1xuXG5cdGZ1bmN0aW9uIGN0cmwoICRzY29wZSwgJGVsZW1lbnQgKSB7XG5cblx0XHQvLyAkc2NvcGUubW92aWVJdGVtIG9iaiBpcyBwYXNzZWQgdGhydSBpc29sYXRlZFNjb3BlIHZpYSBjb21waWxlZCBkaXJlY3RpdmUgaW4gaGVsaXguZmFjLmpzXG5cdFx0dmFyIGltZyA9IG5ldyBJbWFnZSgpO1xuXHRcdHZhciBpbWdVcmwgPSAnaHR0cDovL2ltYWdlLnRtZGIub3JnL3QvcC93MTU0LycgKyAkc2NvcGUubW92aWVJdGVtLnBvc3Rlcl9wYXRoO1xuXHRcdGltZy5vbmxvYWQgPSBmdW5jdGlvbiAoKSB7XG5cblx0XHRcdC8vIHRvZG8gbW92ZSBjc3MgaW50byBzYXNzLCB1c2UgY2xhc3MgaW5zdGVhZFxuXHRcdFx0JGVsZW1lbnQuY3NzKCB7XG5cdFx0XHRcdCd3aWR0aCc6ICcxNTBweCcsXG5cdFx0XHRcdCdoZWlnaHQnOiAnMjMwcHgnLFxuXHRcdFx0XHQnYmFja2dyb3VuZC1yZXBlYXQnOiAnbm8tcmVwZWF0Jyxcblx0XHRcdFx0J2JhY2tncm91bmQtc2l6ZSc6ICcxNTBweCAyMzBweCcsXG5cdFx0XHRcdCdiYWNrZ3JvdW5kLWltYWdlJzogJ3VybCgnICsgaW1nVXJsICsgJyknLFxuXHRcdFx0XHQnZGlzcGxheSc6ICdub25lJyAvLyByZXF1aXJlZCBmb3IgZmFkZUluIGFuaW1hdGlvblxuXHRcdFx0fSApO1xuXHRcdFx0JGVsZW1lbnQuZmFkZUluKCAxNTAwICk7XG5cblx0XHR9O1xuXHRcdGltZy5zcmMgPSBpbWdVcmw7XG5cblx0XHQkZWxlbWVudC5vbiggJ2NsaWNrJywgZnVuY3Rpb24gKCBldnQgKSB7XG5cdFx0XHQkc3RhdGUuZ28oICdtb3ZpZURldGFpbCcsIHsgbW92aWVJZDogJHNjb3BlLm1vdmllSXRlbS5pZCB9ICk7XG5cdFx0XHRjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLnNldEFjdGl2ZUl0ZW0oICRzY29wZS5tb3ZpZUl0ZW0gKTtcblx0XHR9ICk7XG5cblx0fVxuXG5cdHJldHVybiB7XG5cdFx0cmVzdHJpY3Q6ICdFJyxcblx0XHRyZXBsYWNlOiB0cnVlLFxuXHRcdGNvbnRyb2xsZXI6IGN0cmwsXG5cdFx0dGVtcGxhdGU6ICc8ZGl2IGNsYXNzPVwicG9zdGVyRWxlbVwiPjwvZGl2Pidcblx0fTtcblxufSBdO1xuIiwiYW5ndWxhci5tb2R1bGUoICdhcHAnLCBbXG5cdCd1aS5yb3V0ZXInLFxuXHQnbmdBbmltYXRlJ1xuXSApXG4uY29uc3RhbnQoICdFTkRQT0lOVF9VUkknLCAnaHR0cDovL2xvY2FsaG9zdDo4MDAxLycgKVxuLmNvbnN0YW50KCAnVE1EQl9BUEknLCB7XG5cdGtleTogJzM3NGMwMzQyYTY0MDZkZmUwYWViM2RlMmVhMDQyYzU5Jyxcblx0dXJsOiAnaHR0cDovL2FwaS50aGVtb3ZpZWRiLm9yZy8zLydcbn0gKVxuXG4ucHJvdmlkZXIoICdsb2cnLCByZXF1aXJlKCAnLi9jb21tb24vbG9nLnB2LmpzJyApIClcbi5mYWN0b3J5KCAndXRpbCcsIHJlcXVpcmUoICcuL2NvbW1vbi91dGlsLmpzJyApIClcbi5mYWN0b3J5KCAnRVZUJywgcmVxdWlyZSggJy4vY29tbW9uL2V2ZW50cy5mYWMuanMnICkgKVxuXG4uZmFjdG9yeSggJ1RNRGInLCByZXF1aXJlKCAnLi9BUEkvVE1EYi5mYWMuanMnICkgKVxuXG4uY29udHJvbGxlciggJ21haW5DdHJsJywgcmVxdWlyZSggJy4vbWFpbi5jdHJsLmpzJyApIClcbi5mYWN0b3J5KCAnRU5HSU5FJywgcmVxdWlyZSggJy4vaGVsaXgvZW5naW5lLmZhYy5qcycgKSApXG4uZmFjdG9yeSggJ2hlbGl4JywgcmVxdWlyZSggJy4vaGVsaXgvaGVsaXguZmFjLmpzJyApIClcbi5kaXJlY3RpdmUoICdkaXNwbGF5JywgcmVxdWlyZSggJy4vaGVsaXgvZGlzcGxheS5kaXIuanMnICkgKVxuLmRpcmVjdGl2ZSggJ3Bvc3RlcicsIHJlcXVpcmUoICcuL2hlbGl4L3Bvc3Rlci5kaXIuanMnICkgKVxuXG4uY29udHJvbGxlciggJ21vdmllRGV0YWlsQ3RybCcsIHJlcXVpcmUoICcuL21vdmllRGV0YWlsLmN0cmwuanMnICkgKVxuXG4uZmFjdG9yeSggJ2F1dGgnLCByZXF1aXJlKCAnLi9hdXRoL2F1dGguZmFjLmpzJyApIClcbi5mYWN0b3J5KCAnYXV0aFRva2VuJywgcmVxdWlyZSggJy4vYXV0aC9hdXRoVG9rZW4uZmFjLmpzJyApIClcbi5mYWN0b3J5KCAnYXV0aEludGVyY2VwdG9yJywgcmVxdWlyZSggJy4vYXV0aC9hdXRoSW50ZXJjZXB0b3IuZmFjLmpzJyApIClcbi5jb250cm9sbGVyKCAnc2lnbnVwQ3RybCcsIHJlcXVpcmUoICcuL2F1dGgvc2lnbnVwLmN0cmwuanMnICkgKVxuLmNvbnRyb2xsZXIoICdzaWduaW5DdHJsJywgcmVxdWlyZSggJy4vYXV0aC9zaWduaW4uY3RybC5qcycgKSApXG4uY29udHJvbGxlciggJ3NpZ25vdXRDdHJsJywgcmVxdWlyZSggJy4vYXV0aC9zaWdub3V0LmN0cmwuanMnICkgKVxuXG4uY29udHJvbGxlciggJ21vdmllQ29sbGVjdGlvbkN0cmwnLCByZXF1aXJlKCAnLi9tb3ZpZUNvbGxlY3Rpb24vbW92aWVDb2xsZWN0aW9uLmN0cmwuanMnICkgKVxuLmZhY3RvcnkoICdtb3ZpZUNvbGxlY3Rpb24nLCByZXF1aXJlKCAnLi9tb3ZpZUNvbGxlY3Rpb24vbW92aWVDb2xsZWN0aW9uLmZhYy5qcycgKSApXG4uZmFjdG9yeSggJ2NvbGxlY3Rpb25Nb2RhbFNlcnZpY2UnLCByZXF1aXJlKCAnLi9tb3ZpZUNvbGxlY3Rpb24vY29sbGVjdGlvbk1vZGFsU2VydmljZS5mYWMuanMnICkgKVxuLmRpcmVjdGl2ZSggJ2NvbGxlY3Rpb25Nb2RhbCcsIHJlcXVpcmUoICcuL21vdmllQ29sbGVjdGlvbi9jb2xsZWN0aW9uTW9kYWwuZGlyLmpzJyApIClcbi5kaXJlY3RpdmUoICdjb2xsZWN0aW9uSXRlbScsIHJlcXVpcmUoICcuL21vdmllQ29sbGVjdGlvbi9jb2xsZWN0aW9uSXRlbS5kaXIuanMnICkgKVxuXG4uZGlyZWN0aXZlKCAnaG92ZXJDbGFzcycsIHJlcXVpcmUoICcuL2RpcmVjdGl2ZS9ob3ZlckNsYXNzLmRpci5qcycgKSApXG5cbi5jb25maWcoIHJlcXVpcmUoICcuL2NvbmZpZy9yb3V0ZUNvbmZpZy5qcycgKSApXG4uY29uZmlnKCByZXF1aXJlKCAnLi9jb25maWcvbG9nQ29uZmlnLmpzJyApIClcbi5jb25maWcoIHJlcXVpcmUoICcuL2NvbmZpZy9odHRwQ29uZmlnLmpzJyApIClcbi5ydW4oIFsgJ2xvZycsICckcm9vdFNjb3BlJywgJyRzdGF0ZScsICdhdXRoJywgJ21vdmllQ29sbGVjdGlvbicsIGZ1bmN0aW9uICggbG9nLCAkcm9vdFNjb3BlLCAkc3RhdGUsIGF1dGgsIG1vdmllQ29sbGVjdGlvbiApIHtcblxuXHRhdXRoLmF1dGhvcml6ZSggdHJ1ZSApO1xuXG5cdG1vdmllQ29sbGVjdGlvbi5yZXNvbHZlQ29sbGVjdGlvbigpO1xuXG5cdCRyb290U2NvcGUuJG9uKCAnJHN0YXRlQ2hhbmdlRXJyb3InLCBmdW5jdGlvbiAoIGV2ZW50LCB0b1N0YXRlLCB0b1BhcmFtcywgZnJvbVN0YXRlLCBmcm9tUGFyYW1zLCBlcnJvciApIHtcblxuXHRcdGV2ZW50LnByZXZlbnREZWZhdWx0KCk7IC8vIHByZXZlbnQgdHJhbnNpdGlvblxuXHRcdGxvZy5kZWJ1ZyggJ3dhcm4nLCBlcnJvciApO1xuXHRcdGlmICggZXJyb3IgKSB7XG5cdFx0XHQkc3RhdGUuZ28oICdzaWduaW4nICk7XG5cdFx0fVxuXG5cdH0gKTtcblxufSBdIClcbjtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJyRzY29wZScsICdUTURiJywgJ0VWVCcsICdoZWxpeCcsICdFTkdJTkUnLCAnYXV0aCcsICckc3RhdGUnLFxuZnVuY3Rpb24gKCBsb2csICRzY29wZSwgVE1EYiwgRVZULCBoZWxpeCwgRU5HSU5FLCBhdXRoLCAkc3RhdGUgKSB7XG5cblx0dmFyIHZtID0gdGhpcztcblx0dm0uYXV0aCA9IGF1dGg7XG5cdHZtLnNlYXJjaCA9IHtcblx0XHRxdWVyeTogJycsXG5cdH07XG5cdHZtLm1vdmllSXRlbXMgPSBudWxsO1xuXG5cdCRzY29wZS4kd2F0Y2goIFRNRGIuZ2V0UmVzLCBmdW5jdGlvbiAoIG1vdkl0ZW1zLCBvbGRNb3ZJdGVtcyApIHtcblxuXHRcdHZtLm1vdmllSXRlbXMgPSBtb3ZJdGVtcztcblx0XHRoZWxpeC5tYWtlSGVsaXhQb3N0ZXJzKCBtb3ZJdGVtcy5zbGljZSggb2xkTW92SXRlbXMubGVuZ3RoICksIG9sZE1vdkl0ZW1zLmxlbmd0aCApO1xuXG5cdH0sIHRydWUgKTtcblxuXHR2YXIgcHJldlF1ZXJ5ID0gJyc7XG5cdHZtLnNlYXJjaCA9IGZ1bmN0aW9uICgpIHtcblx0XHRpZiAoIHZtLnNlYXJjaC5xdWVyeSA9PT0gJycgKSByZXR1cm47XG5cdFx0aWYgKCBwcmV2UXVlcnkgIT09IHZtLnNlYXJjaC5xdWVyeSApIHtcblx0XHRcdHByZXZRdWVyeSA9IHZtLnNlYXJjaC5xdWVyeTtcblx0XHRcdFRNRGIuY2xlYXJTZWFyY2goKTtcblx0XHRcdGhlbGl4LmNsZWFyQWxsKCk7XG5cdFx0XHRFTkdJTkUucmVzZXRDYW1lcmEoKTtcblx0XHR9XG5cdFx0aWYgKCAkc3RhdGUuY3VycmVudC5uYW1lICE9PSAnaGVsaXgnICkge1xuXHRcdFx0JHN0YXRlLmdvKCAnaGVsaXgnICk7XG5cdFx0fVxuXHRcdFRNRGIuc2VhcmNoQnlUaXRsZSggdm0uc2VhcmNoICk7XG5cdH07XG5cblx0Ly8gREVCVUdcblx0d2luZG93LlNDT1BFID0gJHNjb3BlO1xuXHR2bS5UTURiID0gVE1EYjtcblx0dm0uaGVsaXggPSBoZWxpeDtcblx0dm0uRU5HSU5FID0gRU5HSU5FO1xuXHR2bS5TVEFURSA9ICRzdGF0ZTtcblxuXHRFVlQuRU9QLmxpc3RlbiggZnVuY3Rpb24gKCkge1xuXHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAncmVjaWV2ZWQgRU9QIGV2ZW50IScgKTtcblx0fSApO1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdUTURiJywgZnVuY3Rpb24gKCBsb2csIFRNRGIgKSB7XG5cblx0ZnVuY3Rpb24gY3RybCggJHNjb3BlLCAkYXR0cnMsICRlbGVtZW50ICkge1xuXG5cdFx0VE1EYi5zZWFyY2hCeUlkKCBwYXJzZUludCggJHNjb3BlLm1vdmllSWQgKSApXG5cdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xuXG5cdFx0XHQvLyBsb2cuZGVidWcoICdpbmZvJywgJ2NvbGxlY3Rpb25JdGVtRGlyZWN0aXZlJywgcmVzICk7XG5cdFx0XHR2YXIgaW1nVXJsID0gJ2h0dHA6Ly9pbWFnZS50bWRiLm9yZy90L3AvdzkyLycgKyByZXMucG9zdGVyX3BhdGg7XG5cdFx0XHQkZWxlbWVudC5jc3MoIHtcblx0XHRcdFx0J3dpZHRoJzogJzEwMCUnLFxuXHRcdFx0XHQnaGVpZ2h0JzogJzEwMCUnLFxuXHRcdFx0XHQnYmFja2dyb3VuZC1yZXBlYXQnOiAnbm8tcmVwZWF0Jyxcblx0XHRcdFx0J2JhY2tncm91bmQtc2l6ZSc6ICcxMDAlIDEwMCUnLFxuXHRcdFx0XHQnYmFja2dyb3VuZC1pbWFnZSc6ICd1cmwoJyArIGltZ1VybCArICcpJ1xuXHRcdFx0fSApO1xuXG5cdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XG5cdFx0XHRsb2cuZGVidWcoICdlcnInLCAnY29sbGVjdGlvbkl0ZW1EaXJlY3RpdmUnLCBlcnIgKTtcblx0XHR9ICk7XG5cblx0fVxuXG5cdHJldHVybiB7XG5cdFx0cmVzdHJpY3Q6ICdFJyxcblx0XHRyZXBsYWNlOiB0cnVlLFxuXHRcdHNjb3BlOiB7IG1vdmllSWQ6ICdAJyB9LFxuXHRcdGNvbnRyb2xsZXI6IGN0cmwsXG5cdFx0Y29udHJvbGxlckFzOiAnY2knLFxuXHRcdHRlbXBsYXRlOiAnPGRpdj48L2Rpdj4nXG5cdH07XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJ21vdmllQ29sbGVjdGlvbicsICdjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlJywgJ0VWVCcsXG5mdW5jdGlvbiAoIGxvZywgbW92aWVDb2xsZWN0aW9uLCBjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLCBFVlQgKSB7XG5cblx0ZnVuY3Rpb24gY3RybCggJHNjb3BlLCAkZWxlbWVudCwgJGF0dHJzICkge1xuXG5cdFx0dmFyIHZtID0gdGhpcztcblx0XHR2bS5tb3ZpZUNvbGxlY3Rpb24gPSBtb3ZpZUNvbGxlY3Rpb247XG5cdFx0dm0uY29sbGVjdGlvbk1vZGFsU2VydmljZSA9IGNvbGxlY3Rpb25Nb2RhbFNlcnZpY2U7XG5cblx0XHR2bS5hZGRpbmdOZXdDb2xsZWN0aW9uID0gZmFsc2U7XG5cblx0XHR2bS5vcGVuRWRpdG9yID0gZnVuY3Rpb24gKCkge1xuXHRcdFx0dm0uYWRkaW5nTmV3Q29sbGVjdGlvbiA9IHRydWU7XG5cdFx0fTtcblxuXHRcdHZtLmNsb3NlRWRpdG9yID0gZnVuY3Rpb24gKCkge1xuXHRcdFx0dm0uYWRkaW5nTmV3Q29sbGVjdGlvbiA9IGZhbHNlO1xuXHRcdH07XG5cblx0XHR2bS5jcmVhdGVOZXdDb2xsZWN0aW9uID0gZnVuY3Rpb24gKCkge1xuXHRcdFx0bW92aWVDb2xsZWN0aW9uLmNyZWF0ZSggJHNjb3BlLm5ld0NvbGxlY3Rpb25OYW1lICk7XG5cdFx0XHQkc2NvcGUubmV3Q29sbGVjdGlvbk5hbWUgPSAnJztcblx0XHRcdHZtLmNsb3NlRWRpdG9yKCk7XG5cdFx0fTtcblxuXHRcdHZtLmFkZFRvQ29sbGVjdGlvbiA9IGZ1bmN0aW9uICggbW92aWVJZCwgY29sbGVjdGlvbk5hbWUgKSB7XG5cdFx0XHRsb2cuZGVidWcoICdjb2xsZWN0aW9uJywgJ2FkZFRvQ29sbGVjdGlvbjonLCBtb3ZpZUlkLCBjb2xsZWN0aW9uTmFtZSApO1xuXHRcdFx0dmFyIHN1Y2Nlc3MgPSBtb3ZpZUNvbGxlY3Rpb24ucHVzaCggbW92aWVJZCwgY29sbGVjdGlvbk5hbWUgKTtcblx0XHRcdGxvZy5kZWJ1ZyggJ2NvbGxlY3Rpb24nLCAnbW92aWVDb2xsZWN0aW9uLnB1c2gnLCBzdWNjZXNzICk7XG5cdFx0fTtcblxuXHRcdHZtLmNsb3NlTW9kYWwgPSBmdW5jdGlvbiAoKSB7XG5cdFx0XHR2bS5hZGRpbmdOZXdDb2xsZWN0aW9uID0gZmFsc2U7XG5cdFx0XHQkc2NvcGUubmV3Q29sbGVjdGlvbk5hbWUgPSAnJztcblx0XHRcdGNvbGxlY3Rpb25Nb2RhbFNlcnZpY2UuY2xvc2UoKTtcblx0XHR9O1xuXG5cdFx0Ly8gZGVmYXVsdCBjc3MgYXQgZGlyZWN0aXZlIGluaXRpYWxpemF0aW9uXG5cdFx0JGVsZW1lbnQuY3NzKCB7IHZpc2liaWxpdHk6ICdoaWRkZW4nIH0gKTtcblxuXHRcdEVWVC5jb2xsZWN0aW9uTW9kYWxPcGVuLmxpc3RlbiggZnVuY3Rpb24gKCkge1xuXHRcdFx0bG9nLmRlYnVnKCAnY29sbGVjdGlvbicsICdjb2xsZWN0aW9uTW9kYWxPcGVuJyApO1xuXHRcdCRlbGVtZW50LmNzcyggeyB2aXNpYmlsaXR5OiAndmlzaWJsZScgfSApO1xuXHRcdH0gKTtcblxuXHRcdEVWVC5jb2xsZWN0aW9uTW9kYWxDbG9zZS5saXN0ZW4oIGZ1bmN0aW9uICgpIHtcblx0XHRcdGxvZy5kZWJ1ZyggJ2NvbGxlY3Rpb24nLCAnY29sbGVjdGlvbk1vZGFsQ2xvc2UnICk7XG5cdFx0JGVsZW1lbnQuY3NzKCB7IHZpc2liaWxpdHk6ICdoaWRkZW4nIH0gKTtcblx0XHR9ICk7XG5cblx0fVxuXG5cdHJldHVybiB7XG5cblx0XHRyZXN0cmljdDogJ0UnLFxuXHRcdHNjb3BlOiB7fSxcblx0XHRjb250cm9sbGVyOiBjdHJsLFxuXHRcdGNvbnRyb2xsZXJBczogJ21vZGFsJyxcblx0XHRyZXBsYWNlOiB0cnVlLFxuXHRcdHRlbXBsYXRlVXJsOiAnLi90ZW1wbGF0ZS9jb2xsZWN0aW9uTW9kYWwuaHRtbCdcblxuXHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdFVlQnLCAnYXV0aCcsICckc3RhdGUnLCBmdW5jdGlvbiAoIGxvZywgRVZULCBhdXRoLCAkc3RhdGUgKSB7XG5cblx0dmFyIGFjdGl2ZUl0ZW0gPSBudWxsO1xuXG5cdGZ1bmN0aW9uIHNldEFjdGl2ZUl0ZW0oIGl0ZW0gKSB7XG5cdFx0YWN0aXZlSXRlbSA9IGl0ZW07XG5cdH1cblxuXHRmdW5jdGlvbiBnZXRBY3RpdmVJdGVtKCBpdGVtICkge1xuXHRcdHJldHVybiBhY3RpdmVJdGVtO1xuXHR9XG5cblx0ZnVuY3Rpb24gb3BlbigpIHtcblx0XHRpZiAoIGF1dGguaXNBdXRoZW50aWNhdGVkKCkgKSB7XG5cdFx0XHRFVlQuY29sbGVjdGlvbk1vZGFsT3Blbi5lbWl0KCk7XG5cdFx0fSBlbHNlIHtcblx0XHRcdCRzdGF0ZS5nbyggJ3NpZ25pbicgKTtcblx0XHR9XG5cdH1cblxuXHRmdW5jdGlvbiBjbG9zZSgpIHtcblx0XHRFVlQuY29sbGVjdGlvbk1vZGFsQ2xvc2UuZW1pdCgpO1xuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRzZXRBY3RpdmVJdGVtLFxuXHRcdGdldEFjdGl2ZUl0ZW0sXG5cdFx0b3Blbixcblx0XHRjbG9zZVxuXHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckc2NvcGUnLCAnYXV0aCcsICdtb3ZpZUNvbGxlY3Rpb24nLCAnVE1EYicsICdoZWxpeCcsICdFTkdJTkUnLCAnJHN0YXRlJyxcbmZ1bmN0aW9uICggbG9nLCAkc2NvcGUsIGF1dGgsIG1vdmllQ29sbGVjdGlvbiwgVE1EYiwgaGVsaXgsIEVOR0lORSwgJHN0YXRlICkgIHtcblxuXHRsb2cuZGVidWcoICdjb2xsZWN0aW9uJywgJ2NvbGxlY3Rpb25DdHJsJywgbW92aWVDb2xsZWN0aW9uLmdldENvbGxlY3Rpb24oKSApO1xuXHR2YXIgdm0gPSB0aGlzO1xuXHR2bS5tb3ZpZUNvbGxlY3Rpb24gPSBtb3ZpZUNvbGxlY3Rpb247XG5cblx0dm0udmlld0NvbGxlY3Rpb24gPSBmdW5jdGlvbiAoIGNvbGxlY3Rpb24gKSB7XG5cblx0XHRsb2cuZGVidWcoICdpbmZvJywgJ3ZpZXdDb2xsZWN0aW9uID0+JywgY29sbGVjdGlvbiApO1xuXG5cdFx0dmFyIGxvYWRlZEl0ZW1zID0gMDtcblx0XHR2YXIgdG90YWxJdGVtcyA9IGNvbGxlY3Rpb24ubW92aWVzLmxlbmd0aDtcblx0XHR2YXIgYWxsTW92aWVzID0gW107XG5cblx0XHRjb2xsZWN0aW9uLm1vdmllcy5mb3JFYWNoKCBmdW5jdGlvbiAoIG1vdmllSWQgKSB7XG5cblx0XHRcdFRNRGIuc2VhcmNoQnlJZCggbW92aWVJZCApXG5cdFx0XHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcblx0XHRcdFx0XHRhbGxNb3ZpZXMucHVzaCggcmVzICk7XG5cdFx0XHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xuXHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICd2aWV3Q29sbGVjdGlvbiA9PicsIGVyciApO1xuXHRcdFx0XHR9IClcblx0XHRcdFx0LmZpbmFsbHkoIGZ1bmN0aW9uICgpIHtcblx0XHRcdFx0XHRpZiAoICsrbG9hZGVkSXRlbXMgPT09IHRvdGFsSXRlbXMgKSB7XG5cblx0XHRcdFx0XHRcdGhlbGl4LmNsZWFyQWxsKCk7XG5cdFx0XHRcdFx0XHRFTkdJTkUucmVzZXRDYW1lcmEoKTtcblx0XHRcdFx0XHRcdGhlbGl4Lm1ha2VIZWxpeFBvc3RlcnMoIGFsbE1vdmllcywgMCApO1xuXHRcdFx0XHRcdFx0JHN0YXRlLmdvKCAnaGVsaXgnICk7XG5cblx0XHRcdFx0XHR9XG5cdFx0XHRcdH0gKTtcblxuXHRcdH0gKTtcblxuXG5cdH07XG5cblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnRU5EUE9JTlRfVVJJJywgJyRodHRwJywgJyRxJywgZnVuY3Rpb24gKCBsb2csIEVORFBPSU5UX1VSSSwgJGh0dHAsICRxICkge1xuXG5cdHZhciBEQl9FTkRQT0lOVCA9IEVORFBPSU5UX1VSSSArICdjb2xsZWN0aW9uJztcblx0dmFyIGNvbGxlY3Rpb24gPSBudWxsO1xuXG5cdHZhciBmdWxsQ29sbGVjdGlvbiA9IG51bGw7XG5cblx0ZnVuY3Rpb24gY3JlYXRlKCBuYW1lICkge1xuXHRcdGNvbGxlY3Rpb24ucHVzaCggeyBjb2xsZWN0aW9uTmFtZTogbmFtZSwgbW92aWVzOiBbXSB9ICk7XG5cdFx0cHV0KCk7XG5cdH1cblxuXHRmdW5jdGlvbiBpc0VtcHR5KCkge1xuXHRcdHJldHVybiBjb2xsZWN0aW9uLmxlbmd0aCA9PT0gMDtcblx0fVxuXG5cdGZ1bmN0aW9uIHJlc29sdmVDb2xsZWN0aW9uKCkge1xuXG5cdFx0dmFyIGRlZmVycmVkID0gJHEuZGVmZXIoKTtcblxuXHRcdGlmICggY29sbGVjdGlvbiAhPT0gbnVsbCApIHtcblx0XHRcdGRlZmVycmVkLnJlc29sdmUoIGNvbGxlY3Rpb24gKTtcblx0XHR9IGVsc2Uge1xuXHRcdFx0JGh0dHAuZ2V0KCBEQl9FTkRQT0lOVCwgeyByZXF1aXJlQXV0aDogdHJ1ZSB9IClcblx0XHRcdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xuXHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ2NvbGxlY3Rpb24nLCAnY29sbGVjdGlvbi5yZXNvbHZlQ29sbGVjdGlvbigpOicsIHJlcyApO1xuXHRcdFx0XHRcdGlmICggcmVzLmRhdGEgKSB7XG5cdFx0XHRcdFx0XHRjb2xsZWN0aW9uID0gcmVzLmRhdGE7XG5cdFx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHRcdGNvbGxlY3Rpb24gPSBbXTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0ZGVmZXJyZWQucmVzb2x2ZSggdHJ1ZSApO1xuXHRcdFx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcblx0XHRcdFx0XHRsb2cuZGVidWcoICdlcnInLCAnY29sbGVjdGlvbi5yZXNvbHZlQ29sbGVjdGlvbigpOicsIGVyciApO1xuXHRcdFx0XHRcdGRlZmVycmVkLnJlamVjdCggZXJyICk7XG5cdFx0XHRcdH0gKTtcblx0XHR9XG5cblx0XHRyZXR1cm4gZGVmZXJyZWQucHJvbWlzZTtcblxuXHR9XG5cblx0ZnVuY3Rpb24gaGFzSXRlbSggaXRlbUlkLCBzb21lQ29sbGVjdGlvbiApIHtcblx0XHRmb3IgKCB2YXIgaSA9IDA7IGkgPCBjb2xsZWN0aW9uLmxlbmd0aDsgaSArKyApIHtcblx0XHRcdGlmICggY29sbGVjdGlvbltpXS5jb2xsZWN0aW9uTmFtZSA9PT0gc29tZUNvbGxlY3Rpb24gKSB7XG5cdFx0XHRcdGZvciAoIHZhciBrID0gMDsgayA8IGNvbGxlY3Rpb25baV0ubW92aWVzLmxlbmd0aDsgayArKyApIHtcblx0XHRcdFx0XHRpZiAoIGNvbGxlY3Rpb25baV0ubW92aWVzW2tdID09PSBpdGVtSWQgKSB7XG5cdFx0XHRcdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9XG5cdFx0cmV0dXJuIGZhbHNlO1xuXHR9XG5cblx0ZnVuY3Rpb24gcHV0KCkge1xuXHRcdCRodHRwLnB1dCggREJfRU5EUE9JTlQsIGNvbGxlY3Rpb24sIHsgcmVxdWlyZUF1dGg6IHRydWUgfSApXG5cdFx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XG5cdFx0XHRcdGxvZy5kZWJ1ZyggJ2NvbGxlY3Rpb24nLCAnY29sbGVjdGlvbi5wdXQoKTonLCByZXMgKTtcblx0XHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xuXHRcdFx0XHRsb2cuZGVidWcoICdlcnInLCAnY29sbGVjdGlvbi5wdXQoKTonLCBlcnIgKTtcblx0XHRcdH0gKTtcblx0fVxuXG5cdGZ1bmN0aW9uIHB1c2goIGl0ZW1JZCwgdG9Db2xsZWN0aW9uICkge1xuXHRcdGlmICggaGFzSXRlbSggaXRlbUlkLCB0b0NvbGxlY3Rpb24gKSApIHtcblx0XHRcdHJldHVybiBmYWxzZTtcblx0XHR9XG5cdFx0Zm9yICggdmFyIGkgPSAwOyBpIDwgY29sbGVjdGlvbi5sZW5ndGg7IGkgKysgKSB7XG5cdFx0XHRpZiAoIGNvbGxlY3Rpb25baV0uY29sbGVjdGlvbk5hbWUgPT09IHRvQ29sbGVjdGlvbiApIHtcblx0XHRcdFx0Y29sbGVjdGlvbltpXS5tb3ZpZXMucHVzaCggaXRlbUlkICk7XG5cdFx0XHRcdHB1dCgpO1xuXHRcdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHRcdH1cblx0XHR9XG5cdFx0cmV0dXJuIGZhbHNlO1xuXHR9XG5cblx0ZnVuY3Rpb24gcmVtb3ZlKCBpdGVtSWQsIGluQ29sbGVjdGlvbiApIHtcblx0XHRmb3IgKCB2YXIgaSA9IDA7IGkgPCBjb2xsZWN0aW9uLmxlbmd0aDsgaSArKyApIHtcblx0XHRcdGlmICggY29sbGVjdGlvbltpXS5jb2xsZWN0aW9uTmFtZSA9PT0gaW5Db2xsZWN0aW9uICkge1xuXHRcdFx0XHRmb3IgKCB2YXIgayA9IDA7IGsgPCBjb2xsZWN0aW9uW2ldLm1vdmllcy5sZW5ndGg7IGsgKysgKSB7XG5cdFx0XHRcdFx0aWYgKCBjb2xsZWN0aW9uW2ldLm1vdmllc1trXSA9PT0gaXRlbUlkICkge1xuXHRcdFx0XHRcdFx0dmFyIHJlbW92ZWQgPSBjb2xsZWN0aW9uW2ldLm1vdmllcy5zcGxpY2UoIGssIDEgKS5sZW5ndGg7XG5cdFx0XHRcdFx0XHRwdXQoKTtcblx0XHRcdFx0XHRcdHJldHVybiByZW1vdmVkICE9PSAwO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH1cblx0XHRyZXR1cm4gZmFsc2U7XG5cdH1cblxuXHRmdW5jdGlvbiByZW1vdmVDb2xsZWN0aW9uKCBjb2xsZWN0aW9uTmFtZSApIHtcblx0XHRmb3IgKCB2YXIgaSA9IDA7IGkgPCBjb2xsZWN0aW9uLmxlbmd0aDsgaSArKyApIHtcblx0XHRcdGlmICggY29sbGVjdGlvbltpXS5jb2xsZWN0aW9uTmFtZSA9PT0gY29sbGVjdGlvbk5hbWUgKSB7XG5cdFx0XHRcdHZhciByZW1vdmVkID0gY29sbGVjdGlvbi5zcGxpY2UoIGksIDEgKS5sZW5ndGg7XG5cdFx0XHRcdHB1dCgpO1xuXHRcdFx0XHRyZXR1cm4gcmVtb3ZlZCAhPT0gMDtcblx0XHRcdH1cblx0XHR9XG5cdFx0cmV0dXJuIGZhbHNlO1xuXHR9XG5cblx0ZnVuY3Rpb24gc3luYygpIHtcblx0XHQvLyBzeW5jIGxvY2FsIGNvbGVsY3Rpb24gdy8gREJcblx0fVxuXG5cdGZ1bmN0aW9uIGdldENvbGxlY3Rpb24oKSB7XG5cdFx0cmV0dXJuIGNvbGxlY3Rpb247XG5cdH1cblxuXHRmdW5jdGlvbiBfY2xlYXIoKSB7XG5cdFx0Y29sbGVjdGlvbiA9IG51bGw7XG5cdFx0bG9nLmRlYnVnKCAnY29sbGVjdGlvbicsICdsb2NhbCBjb2xsZWN0aW9uIGNsZWFyZWQuJyApO1xuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRnZXRDb2xsZWN0aW9uLFxuXHRcdGNyZWF0ZSxcblx0XHRwdXNoLFxuXHRcdHB1dCxcblx0XHRyZW1vdmUsXG5cdFx0cmVtb3ZlQ29sbGVjdGlvbixcblx0XHRzeW5jLFxuXHRcdF9jbGVhcixcblx0XHRyZXNvbHZlQ29sbGVjdGlvbixcblx0XHRoYXNJdGVtLFxuXHRcdGlzRW1wdHlcblx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJ1RNRGInLCAnJGNhY2hlRmFjdG9yeScsICdtb3ZpZUl0ZW0nLCAnY29sbGVjdGlvbk1vZGFsU2VydmljZScsICdtb3ZpZUNvbGxlY3Rpb24nLFxuZnVuY3Rpb24oIGxvZywgJHNjb3BlLCBUTURiLCAkY2FjaGVGYWN0b3J5LCBtb3ZpZUl0ZW0sIGNvbGxlY3Rpb25Nb2RhbFNlcnZpY2UsIG1vdmllQ29sbGVjdGlvbiApIHtcblxuXHR2YXIgdm0gPSB0aGlzO1xuXHR2bS5tb3ZpZUl0ZW0gPSBtb3ZpZUl0ZW07IC8vIG1vdmllSXRlbSBpbmplY3RlZCB2aWEgc3RhdGUgcmVzb2x2ZVxuXHRsb2cuZGVidWcoICdjdHJsJywgJ21vdmllRGV0YWlsIGN0cmwgcmVzb2x2ZWQ6Jywgdm0ubW92aWVJdGVtICk7XG5cblx0bW92aWVJdGVtLmZ1bGxUaXRsZSA9IG1vdmllSXRlbS50aXRsZTtcblx0aWYgKCBtb3ZpZUl0ZW0udGl0bGUgIT09IG1vdmllSXRlbS5vcmlnaW5hbF90aXRsZSApIHtcblx0XHRtb3ZpZUl0ZW0uZnVsbFRpdGxlID0gbW92aWVJdGVtLnRpdGxlICsgJyAoJyArIG1vdmllSXRlbS5vcmlnaW5hbF90aXRsZSArICcpJztcblx0fVxuXG5cdGlmICggbW92aWVJdGVtLmJhY2tkcm9wX3BhdGggKSB7XG5cdFx0dmFyIGltZ1VybCA9ICdodHRwOi8vaW1hZ2UudG1kYi5vcmcvdC9wL29yaWdpbmFsJyArIG1vdmllSXRlbS5iYWNrZHJvcF9wYXRoO1xuXHRcdCQoICcuYmFja2Ryb3AnICkuY3NzKCB7XG5cdFx0XHQnYmFja2dyb3VuZC1pbWFnZSc6ICd1cmwoJyArIGltZ1VybCArICcpJ1xuXHRcdH0gKTtcblx0fVxuXG5cdHZtLm9wZW5Db2xsZWN0aW9uTW9kYWwgPSBmdW5jdGlvbiAoKSB7XG5cdFx0Y29sbGVjdGlvbk1vZGFsU2VydmljZS5zZXRBY3RpdmVJdGVtKCBtb3ZpZUl0ZW0gKTtcblx0XHRjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLm9wZW4oKTtcblx0fTtcblxufSBdO1xuIl19
